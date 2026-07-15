'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QrCode, ArrowRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { formatRupiah } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

type ParsedQris = {
  sessionId: string;
  merchantName: string | null;
  transactionAmount: string | null;
  usdcAmount: number | null;
  exchangeRateUsed: number;
  isMockRate: boolean;
};

// G... Stellar public key
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

export default function CreateEscrowPage() {
  const { isAuthenticated, publicKey, isConnecting } = useAuthStore();
  const { t } = useTranslation();
  const router = useRouter();

  const [qrisString, setQrisString] = useState('');
  const [sellerAddress, setSellerAddress] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedQris | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [createStep, setCreateStep] = useState<'CREATE' | 'FUND' | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !localStorage.getItem('titip_jwt')) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, router]);

  const handleParse = async () => {
    if (!qrisString.trim()) return;
    try {
      setIsParsing(true);
      setParseError(null);
      setParsedData(null);

      const res = await fetch('/api/qris/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ payload: qrisString.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse QRIS');

      setParsedData(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse QRIS');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFund = async () => {
    if (!parsedData || !publicKey || parsedData.usdcAmount === null) return;
    if (!STELLAR_ADDRESS_RE.test(sellerAddress)) {
      setCreateError(t('createEscrow.sellerAddressInvalid'));
      return;
    }
    try {
      setIsCreating(true);
      setCreateError(null);

      const requestBody = {
        buyerAddress: publicKey,
        sellerAddress,
        amountUsdc: parsedData.usdcAmount.toFixed(7),
        qrisSessionId: parsedData.sessionId,
      };

      // 1. Build the unsigned create_escrow() transaction
      setCreateStep('CREATE');
      const createRes = await fetch('/api/escrow/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify(requestBody),
      });

      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || 'Failed to build create transaction');

      // 2. Buyer signs create_escrow() — required since the contract enforces
      //    buyer.require_auth(). Network guard runs inside signTx().
      const signedCreateXdr = await signTx(createData.createTxXdr);

      // 3. Submit the signed create tx; the server reads back the real
      //    contract-assigned escrow ID and returns the unsigned fund() XDR.
      const confirmRes = await fetch('/api/escrow/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ ...requestBody, signedCreateXdr }),
      });

      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Failed to confirm escrow creation');

      const { escrowId, unsignedFundXdr } = confirmData;

      // 4. Buyer signs fund()
      setCreateStep('FUND');
      const signedFundXdr = await signTx(unsignedFundXdr);

      // 5. Submit the signed fund tx; the server verifies it on-chain
      const fundRes = await fetch(`/api/escrow/${escrowId}/fund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ signedXdr: signedFundXdr }),
      });

      const fundData = await fundRes.json();
      if (!fundRes.ok) throw new Error(fundData.error || 'Failed to submit funding transaction');

      router.push(`/escrow/${escrowId}`);
    } catch (err) {
      console.error(err);
      if (err instanceof FreighterError) {
        setCreateError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setCreateError(err instanceof Error ? err.message : 'Failed to fund escrow');
      }
      setIsCreating(false);
      setCreateStep(null);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <main className="container max-w-2xl py-10 sm:py-16">
      <h1 className="mb-2 text-3xl font-bold sm:text-4xl">{t('createEscrow.title')}</h1>
      <p className="mb-8 text-muted-foreground sm:mb-12">{t('createEscrow.subtitle')}</p>

      <Card className="animate-fade-in p-5 sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <QrCode size={24} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-2 text-lg font-semibold sm:text-xl">{t('createEscrow.pasteQris')}</h3>
            <Textarea
              rows={6}
              placeholder="00020101021126660016ID.CO.SHOPEE.WWW0118936009180000000000..."
              value={qrisString}
              onChange={(e) => setQrisString(e.target.value)}
              className="resize-y font-mono text-sm"
              disabled={isParsing || isCreating || !!parsedData}
            />
          </div>
        </div>

        {parseError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle size={20} />
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {!parsedData ? (
          <div className="flex justify-end">
            <Button onClick={handleParse} disabled={!qrisString.trim() || isParsing} className="w-full sm:w-auto">
              {isParsing ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> {t('createEscrow.parsingQris')}
                </>
              ) : (
                <>
                  {t('createEscrow.analyzeInvoice')} <ArrowRight size={18} />
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="animate-fade-in mt-8 border-t border-border pt-8">
            <div className="mb-6 flex items-center gap-3 text-success">
              <CheckCircle2 size={24} />
              <h3 className="text-lg font-semibold text-foreground sm:text-xl">
                {t('createEscrow.invoiceVerified')}
              </h3>
            </div>

            <div className="mb-8 grid gap-4 rounded-xl border border-border bg-black/20 p-5 sm:p-6">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('createEscrow.merchant')}</span>
                <span className="text-right font-semibold">
                  {parsedData.merchantName ?? t('createEscrow.unknown')}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('createEscrow.amountIdr')}</span>
                <span className="font-semibold">
                  {parsedData.transactionAmount
                    ? formatRupiah(Number(parsedData.transactionAmount))
                    : t('createEscrow.unknown')}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-4 border-t border-dashed border-border pt-4">
                <span className="text-muted-foreground">{t('createEscrow.requiredUsdc')}</span>
                <span className="text-xl font-bold text-primary">
                  {parsedData.usdcAmount !== null ? parsedData.usdcAmount.toFixed(2) : '—'} USDC
                </span>
              </div>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  {t('createEscrow.exchangeRate')}
                  {parsedData.isMockRate && <Badge variant="warning">{t('createEscrow.testnetRateBadge')}</Badge>}
                </span>
                <span className="text-muted-foreground">1 USDC = {formatRupiah(parsedData.exchangeRateUsed)}</span>
              </div>
            </div>

            <div className="mb-8">
              <Label htmlFor="seller-address" className="mb-2 block">
                {t('createEscrow.sellerAddressLabel')}
              </Label>
              <Input
                id="seller-address"
                placeholder="GSELLERADDRESS...56 characters"
                value={sellerAddress}
                onChange={(e) => setSellerAddress(e.target.value.trim())}
                className="font-mono text-sm"
                disabled={isCreating}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t('createEscrow.sellerAddressHelp')}
                {/* v1.1: resolve seller address from QRIS merchant ID via directory/registry */}
              </p>
            </div>

            {createError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle size={20} />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setParsedData(null);
                  setQrisString('');
                  setSellerAddress('');
                }}
                disabled={isCreating}
                className="w-full sm:w-auto"
              >
                {t('createEscrow.cancel')}
              </Button>
              <Button onClick={handleFund} disabled={isCreating || !sellerAddress} className="w-full sm:w-auto">
                {isCreating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />{' '}
                    {createStep === 'FUND' ? t('createEscrow.signFund') : t('createEscrow.signCreate')}
                  </>
                ) : (
                  <>{t('createEscrow.lockUsdc', { amount: parsedData.usdcAmount?.toFixed(2) ?? '' })}</>
                )}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
