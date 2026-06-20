#!/bin/bash
# Generate self-signed TLS certificates for local development

cd "$(dirname "$0")"

echo "🔐 Generating self-signed TLS certificates..."
openssl req -x509 -newkey rsa:2048 -nodes -out cert.pem -keyout key.pem -days 365 -subj "/CN=localhost"

if [ -f cert.pem ] && [ -f key.pem ]; then
  echo "✅ Certificates generated successfully!"
  echo ""
  echo "Files created:"
  ls -lh cert.pem key.pem
  echo ""
  echo "⚠️  Browser Warning: You'll see a security warning in your browser"
  echo "    This is normal for self-signed certificates in development."
  echo "    Click 'Advanced' → 'Proceed to localhost' to continue."
else
  echo "❌ Failed to generate certificates"
  exit 1
fi
