/**
 * RFC 6238 Time-Based One-Time Password (TOTP) Implementation
 * High-performance, 100% synchronous pure JavaScript engine.
 * Works offline, in any browser context (HTTP, HTTPS, Localhost, Webview).
 */

const TOTPGenerator = (() => {
    // Pure JS SHA-1 Implementation
    function sha1(bytes) {
        function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }

        const msg = Array.from(bytes);
        const origLenBits = msg.length * 8;
        msg.push(0x80);
        while ((msg.length % 64) !== 56) msg.push(0);

        // Append 64-bit length (big-endian)
        for (let i = 7; i >= 0; i--) {
            msg.push((origLenBits >>> (i * 8)) & 0xff);
        }

        let h0 = 0x67452301;
        let h1 = 0xefcdab89;
        let h2 = 0x98badcfe;
        let h3 = 0x10325476;
        let h4 = 0xc3d2e1f0;

        const w = new Uint32Array(80);

        for (let i = 0; i < msg.length; i += 64) {
            for (let t = 0; t < 16; t++) {
                w[t] = (msg[i + t * 4] << 24) |
                       (msg[i + t * 4 + 1] << 16) |
                       (msg[i + t * 4 + 2] << 8) |
                       (msg[i + t * 4 + 3]);
            }
            for (let t = 16; t < 80; t++) {
                w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
            }

            let a = h0, b = h1, c = h2, d = h3, e = h4;
            for (let t = 0; t < 80; t++) {
                let f, k;
                if (t < 20) {
                    f = (b & c) | ((~b) & d);
                    k = 0x5a827999;
                } else if (t < 40) {
                    f = b ^ c ^ d;
                    k = 0x6ed9eba1;
                } else if (t < 60) {
                    f = (b & c) | (b & d) | (c & d);
                    k = 0x8f1bbcdc;
                } else {
                    f = b ^ c ^ d;
                    k = 0xca62c1d6;
                }

                const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
                e = d;
                d = c;
                c = rotl(b, 30);
                b = a;
                a = temp;
            }

            h0 = (h0 + a) | 0;
            h1 = (h1 + b) | 0;
            h2 = (h2 + c) | 0;
            h3 = (h3 + d) | 0;
            h4 = (h4 + e) | 0;
        }

        const out = [];
        for (const h of [h0, h1, h2, h3, h4]) {
            out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
        }
        return out;
    }

    // HMAC-SHA1
    function hmacSha1(keyBytes, messageBytes) {
        let key = Array.from(keyBytes);
        if (key.length > 64) key = sha1(key);
        while (key.length < 64) key.push(0);

        const oKeyPad = key.map(b => b ^ 0x5c);
        const iKeyPad = key.map(b => b ^ 0x36);

        const inner = sha1(iKeyPad.concat(Array.from(messageBytes)));
        return sha1(oKeyPad.concat(inner));
    }

    const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /**
     * Sanitizes any raw secret key or URL (e.g. BrowserScan, Google Authenticator URL, or space-delimited seeds)
     */
    function cleanSecret(raw) {
        if (!raw) return '';
        let str = String(raw).trim();

        // Handle BrowserScan URL format (e.g. https://www.browserscan.net/2fa#p7fonocrqurbuv7lphiygmijrfnrbor3)
        if (str.includes('#')) {
            const parts = str.split('#');
            if (parts[1]) str = parts[1];
        }

        // Handle otpauth://totp/...?secret=XXXX
        if (str.includes('secret=')) {
            const match = str.match(/secret=([A-Za-z0-9]+)/i);
            if (match && match[1]) str = match[1];
        }

        // Remove all whitespace, dashes, underscores, and equal signs
        return str.toUpperCase().replace(/[\s\-_=]/g, '');
    }

    /**
     * Decodes Base32 to Byte Array
     */
    function base32ToBytes(base32) {
        const cleaned = cleanSecret(base32);
        let bits = 0;
        let value = 0;
        const bytes = [];

        for (let i = 0; i < cleaned.length; i++) {
            const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
            if (idx === -1) continue; // ignore invalid chars

            value = (value << 5) | idx;
            bits += 5;

            if (bits >= 8) {
                bytes.push((value >>> (bits - 8)) & 255);
                bits -= 8;
            }
        }
        return bytes;
    }

    /**
     * Synchronous RFC 6238 TOTP generator
     */
    function generate(secret, epochSeconds = null) {
        if (!secret || String(secret).trim() === '') {
            return { code: '-', formatted: '-', remaining: 30, valid: false };
        }

        const cleanedSecret = String(secret).trim();

        // If it's already a static 6-digit code
        if (/^\d{6}$/.test(cleanedSecret)) {
            const now = epochSeconds || Math.floor(Date.now() / 1000);
            const remaining = 30 - (now % 30);
            return {
                code: cleanedSecret,
                formatted: `${cleanedSecret.slice(0, 3)} ${cleanedSecret.slice(3)}`,
                remaining,
                valid: true,
                manual: true
            };
        }

        try {
            const keyBytes = base32ToBytes(cleanedSecret);
            if (keyBytes.length === 0) {
                return { code: '-', formatted: '-', remaining: 30, valid: false };
            }

            const now = epochSeconds || Math.floor(Date.now() / 1000);
            const remaining = 30 - (now % 30);
            const counter = Math.floor(now / 30);

            // Counter to 8-byte big-endian
            const counterBytes = new Uint8Array(8);
            let temp = counter;
            for (let i = 7; i >= 0; i--) {
                counterBytes[i] = temp & 0xff;
                temp = Math.floor(temp / 256);
            }

            const hash = hmacSha1(keyBytes, counterBytes);

            // Dynamic truncation (RFC 4226 / RFC 6238)
            const offset = hash[hash.length - 1] & 0x0f;
            const binary =
                ((hash[offset] & 0x7f) << 24) |
                ((hash[offset + 1] & 0xff) << 16) |
                ((hash[offset + 2] & 0xff) << 8) |
                (hash[offset + 3] & 0xff);

            const otp = binary % 1000000;
            const code = String(otp).padStart(6, '0');
            const formatted = `${code.slice(0, 3)} ${code.slice(3)}`;

            return {
                code,
                formatted,
                remaining,
                valid: true
            };
        } catch (err) {
            console.error('TOTP error for secret:', err);
            return { code: '-', formatted: '-', remaining: 30, valid: false };
        }
    }

    return {
        generate,
        cleanSecret,
        base32ToBytes
    };
})();

// Attach globally
window.TOTPGenerator = TOTPGenerator;
