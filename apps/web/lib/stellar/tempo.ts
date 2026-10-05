/**
 * TEMPO Anchor Integration (SEP-24 & SEP-10)
 * Allows for IDR <-> USDC on/off-ramping.
 */

export interface StellarToml {
  WEB_AUTH_ENDPOINT?: string;
  TRANSFER_SERVER_SEP0024?: string;
  [key: string]: any;
}

/**
 * Fetches and parses the stellar.toml file from a given domain.
 */
export async function fetchStellarToml(domain: string = 'tempo.eu.com'): Promise<StellarToml> {
  try {
    const res = await fetch(`https://${domain}/.well-known/stellar.toml`);
    if (!res.ok) throw new Error('Failed to fetch stellar.toml');
    const text = await res.text();
    
    const toml: StellarToml = {};
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
      
      const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"$/);
      if (match) {
        toml[match[1]] = match[2];
      }
    }
    
    return toml;
  } catch (error) {
    console.error(`Error fetching stellar.toml from ${domain}:`, error);
    throw error;
  }
}

/**
 * Generates the interactive URL for SEP-24 deposits/withdrawals.
 * Requires a SEP-10 JWT authenticated with the Anchor's WEB_AUTH_ENDPOINT.
 */
export async function getInteractiveUrl(
  action: 'deposit' | 'withdraw',
  assetCode: string,
  jwt: string,
  transferServer: string
): Promise<string> {
  const url = `${transferServer}/transactions/${action}/interactive`;
  
  const formData = new FormData();
  formData.append('asset_code', assetCode);
  // Add other required parameters based on SEP-24 (e.g. account, lang) if needed
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
    },
    body: formData,
  });
  
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`SEP-24 ${action} failed: ${res.status} ${errorText}`);
  }
  
  const data = await res.json();
  if (!data.url) throw new Error('No interactive URL returned from Anchor');
  
  return data.url;
}
