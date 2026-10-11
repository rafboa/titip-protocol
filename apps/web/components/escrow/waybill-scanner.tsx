'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/use-translation';
import { extractWaybillCandidates, type WaybillCandidate } from '@/lib/waybill/extract';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Lets the seller photograph a courier receipt and suggests tracking numbers found by OCR.
 * The image never leaves the browser (Tesseract.js runs client-side). The seller must pick a
 * suggestion, which only fills the form; nothing is submitted automatically.
 */
export function WaybillScanner({
  onPick,
  disabled,
}: {
  onPick: (candidate: WaybillCandidate) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<WaybillCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setCandidates(null);

    if (!file.type.startsWith('image/')) {
      setError(t('tracking.scanNotImage'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('tracking.scanTooLarge'));
      return;
    }

    try {
      setIsScanning(true);
      // Loaded lazily: the OCR engine is large and only needed when the seller scans.
      // TODO(mainnet): self-host the tesseract worker/core/language data instead of the default CDN.
      const { recognize } = await import('tesseract.js');
      const { data } = await recognize(file, 'eng');
      setCandidates(extractWaybillCandidates(data.text));
    } catch {
      setError(t('tracking.scanFailed'));
    } finally {
      setIsScanning(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={t('tracking.scanReceipt')}
        onChange={(e) => void handleFile(e.target.files?.[0])}
        disabled={disabled || isScanning}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isScanning}
        className="w-full sm:w-auto"
      >
        {isScanning ? (
          <>
            <Loader2 size={18} className="animate-spin" /> {t('tracking.scanning')}
          </>
        ) : (
          <>
            <Camera size={18} /> {t('tracking.scanReceipt')}
          </>
        )}
      </Button>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {candidates && candidates.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{t('tracking.scanNone')}</p>
      )}

      {candidates && candidates.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-muted-foreground">{t('tracking.scanPick')}</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <Button
                key={candidate.value}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  onPick(candidate);
                  setCandidates(null);
                }}
              >
                {candidate.value}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
