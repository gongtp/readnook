export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持安全内容摘要，请通过 HTTPS 打开 ReadNook。')
  }

  const source = new Uint8Array(bytes.byteLength)
  source.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
