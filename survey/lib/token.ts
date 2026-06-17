export function generateToken(): string {
  // 9 bytes → 12 chars base64url. Web Crypto for Edge Runtime compatibility.
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
