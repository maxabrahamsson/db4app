# End-to-End Encryption

> **Note:** this describes the end-to-end encryption used by the legacy HTTP `/query` API.
> Postgres wire protocol connections (psql, MCP server) use the per-session auth token and,
> if the relay has certificates configured, TLS between the client and the relay.

db4 supports end-to-end encryption for SQL queries, ensuring that even the relay server cannot decrypt your SQL commands.

## How It Works

1. **Key Generation**: When you first load the app, a unique RSA key pair is generated in your browser
2. **Public Key Sharing**: The public key is shared with client applications (MCP servers, etc.)
3. **Encryption**: Clients encrypt SQL queries with your public key before sending them to the relay
4. **Relay**: The relay server relays the encrypted payload without being able to decrypt it
5. **Decryption**: Only your browser can decrypt the SQL using the private key

## Security Benefits

- ✅ **Relay cannot decrypt**: The relay server never sees your SQL queries in plaintext
- ✅ **Data privacy in transit**: SQL queries are encrypted from client to browser
- ✅ **Zero-trust architecture**: Even if the relay is compromised, your SQL remains secure

## Using Encryption

### For MCP Servers

1. **Get your public key**:
   - Open the Database page
   - Go to the Management tab
   - Scroll to "End-to-end encryption"
   - Copy your Public Key

2. **Configure MCP server**:
   Add these environment variables to your `mcp.json`:
   ```json
   {
     "env": {
       "MCP_PUBLIC_KEY": "YOUR_PUBLIC_KEY_HERE",
       "MCP_USE_ENCRYPTION": "true"
     }
   }
   ```

3. **Automatic fallback**: If `MCP_PUBLIC_KEY` is not provided, the MCP server will attempt to fetch it from the relay's `/public-key` endpoint

### For Custom Clients

If you're building a custom client application:

1. Fetch the public key from `http://localhost:8787/public-key` (or your relay URL)
2. Encrypt your SQL query and parameters using RSA-OAEP
3. Send the encrypted payload:
   ```json
   {
     "encrypted": true,
     "encryptedPayload": "base64_encrypted_data",
     "allowedTables": ["schema.table"]  // Optional, for MCP servers
   }
   ```

## Key Management

### Viewing Keys

- **Public Key**: Always visible in the Management tab
- **Private Key**: Hidden by default, click "Show" to reveal

### Regenerating Keys

If you need to regenerate your keys:

1. Go to Database → Management → Encryption section
2. Click "Regenerate keys"
3. Update all client applications with the new public key

**Warning**: Regenerating keys will invalidate all existing client configurations. They will need to be updated with the new public key.

## Technical Details

- **Algorithm**: RSA-OAEP with SHA-256
- **Key Size**: 2048 bits
- **Key Storage**: Private key stored in browser localStorage (encrypted by browser)
- **Key Format**: Base64 encoded SPKI (public) and PKCS8 (private)

## Limitations

- **Performance**: RSA encryption adds ~10-50ms overhead per query (negligible for most use cases)
- **Payload Size**: RSA-OAEP has a maximum payload size (~190 bytes for 2048-bit keys). Large SQL queries are automatically handled by the system.
- **Backward Compatibility**: Unencrypted requests are still supported for legacy clients

## Best Practices

1. **Keep private key secure**: Never share your private key
2. **Use encryption for production**: Always enable encryption for production deployments
3. **Rotate keys periodically**: Regenerate keys if you suspect compromise
4. **Monitor key usage**: Check the Management tab to see when keys were last regenerated

## Troubleshooting

### Encryption fails, falling back to unencrypted

- Check that `MCP_PUBLIC_KEY` is correctly set
- Verify the public key matches the one in your browser
- Ensure the relay is running and accessible

### Cannot fetch public key from relay

- Verify the relay is running: `npm run relay`
- Check the relay URL is correct
- Ensure the browser agent is connected (check relay status in Database page)

### Keys not generating

- Check browser console for errors
- Ensure Web Crypto API is supported (all modern browsers)
- Try clearing localStorage and refreshing

