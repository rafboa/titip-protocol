'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileImage, ImagePlus, Loader2, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';
import { truncateAddress } from '@/lib/utils';
import { EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES, sha256HexOfBlob } from '@/lib/evidence/file';
import type { EvidenceItem } from '@/lib/evidence/merge';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

type EvidenceList = {
  items: EvidenceItem[];
  limit: number;
  /** Uploads the viewer has left; null for a reader who is not a party. */
  remaining: number | null;
  canUpload: boolean;
};

/**
 * Dispute evidence for a DISPUTED escrow. The photo is hashed in the browser, uploaded, and its hash is
 * committed on-chain with ONE Freighter signature (`submit_evidence`). The list always comes from the
 * contract, so a committed item stays visible even if the file behind it is gone.
 */
export function DisputeEvidence({ escrowId, readOnly = false }: { escrowId: string; readOnly?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const { data, isLoading, error: loadError } = useQuery<EvidenceList>({
    queryKey: ['evidence', escrowId],
    queryFn: async () => {
      const res = await fetch(`/api/escrow/${escrowId}/evidence`);
      if (!res.ok) throw new Error('Failed to fetch evidence');
      return res.json();
    },
    refetchInterval: 15000,
  });

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setJustSubmitted(false);
    if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(picked.type)) {
      setError(t('evidence.notImage'));
      return;
    }
    if (picked.size > MAX_EVIDENCE_BYTES) {
      setError(t('evidence.tooLarge'));
      return;
    }
    setFile(picked);
  };

  const handleSubmit = async () => {
    if (!file) return;
    try {
      setIsSubmitting(true);
      setError(null);
      setJustSubmitted(false);

      // 1. Hash in the browser and upload; the server re-hashes and builds the transaction from its own hash.
      const form = new FormData();
      form.set('file', file);
      form.set('sha256', await sha256HexOfBlob(file));
      const uploadRes = await fetch(`/api/escrow/${escrowId}/evidence`, { method: 'POST', body: form });
      const upload = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(upload.error || 'Failed to upload evidence');

      // 2. Sign with Freighter (skipped when the same photo was already committed)
      let signedXdr = '';
      if (!upload.committed) signedXdr = await signTx(upload.unsignedXdr);

      // 3. Commit: the server submits it and checks the contract now holds the hash
      if (!upload.committed) {
        const commitRes = await fetch(`/api/escrow/${escrowId}/evidence/${upload.evidenceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedXdr }),
        });
        const commit = await commitRes.json();
        if (!commitRes.ok) throw new Error(commit.error || 'Failed to submit evidence');
      }

      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setJustSubmitted(true);
      await queryClient.invalidateQueries({ queryKey: ['evidence', escrowId] });
    } catch (err) {
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit evidence');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const limitReached = data?.remaining === 0;

  return (
    <Card variant="glass" className="mb-8 p-5 sm:p-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold sm:text-xl">
        <FileImage size={20} className="text-primary" /> {t('evidence.title')}
      </h3>
      <p className="mb-6 text-muted-foreground">{t(readOnly ? 'evidence.readOnlySubtitle' : 'evidence.subtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {justSubmitted && (
        <Alert variant="success" className="mb-6">
          <CheckCircle2 size={20} />
          <AlertDescription>{t('evidence.submitted')}</AlertDescription>
        </Alert>
      )}

      {data?.canUpload && (
        <div className="mb-6">
          {limitReached ? (
            <p className="text-sm text-muted-foreground">{t('evidence.limitReached', { limit: data.limit })}</p>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={EVIDENCE_MIME_TYPES.join(',')}
                className="sr-only"
                aria-label={t('evidence.choosePhoto')}
                onChange={(e) => pickFile(e.target.files?.[0])}
                disabled={isSubmitting}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  <ImagePlus size={18} /> {file ? t('evidence.changePhoto') : t('evidence.choosePhoto')}
                </Button>
                {file && <span className="truncate text-sm text-muted-foreground">{file.name}</span>}
              </div>

              {file && (
                <Button onClick={handleSubmit} disabled={isSubmitting} className="mt-4 w-full sm:w-auto">
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> {t('evidence.submitting')}
                    </>
                  ) : (
                    t('evidence.submit')
                  )}
                </Button>
              )}

              <p className="mt-3 text-sm text-muted-foreground">
                {t('evidence.signHint')}
                {data.remaining !== null && ` ${t('evidence.slotsLeft', { count: data.remaining, limit: data.limit })}`}
              </p>
            </>
          )}
        </div>
      )}

      {data?.canUpload && <Separator className="mb-6" />}

      <h4 className="mb-4 font-semibold">{t('evidence.listTitle')}</h4>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={32} className="animate-spin text-primary" />
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertCircle size={20} />
          <AlertDescription>{t('evidence.loadError')}</AlertDescription>
        </Alert>
      ) : data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('evidence.empty')}</p>
      ) : (
        <ul className="grid gap-4">
          {data?.items.map((item, i) => (
            <li key={item.index}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t(item.role === 'BUYER' ? 'evidence.buyer' : 'evidence.seller')}</Badge>
                  {item.mine && <Badge variant="default">{t('evidence.you')}</Badge>}
                  <Badge variant="success">{t('evidence.onChain')}</Badge>
                </div>
                {item.fileId ? (
                  <a
                    href={`/api/escrow/${escrowId}/evidence/${item.fileId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    {t('evidence.viewPhoto')} <ExternalLink size={14} />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('evidence.fileUnavailable')}</span>
                )}
              </div>
              <p className="mt-2 font-mono text-sm text-muted-foreground">
                {t('evidence.fingerprint')}: {truncateAddress(item.sha256, 8)} · {t('evidence.ledger', { ledger: item.ledger })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
