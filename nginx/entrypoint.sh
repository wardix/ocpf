#!/bin/sh

# Default domain name if not set
export DOMAIN_NAME=${DOMAIN_NAME:-localhost}

echo "Starting Nginx gateway for domain: $DOMAIN_NAME"

SSL_DIR="/etc/nginx/ssl/live/$DOMAIN_NAME"
mkdir -p "$SSL_DIR"

if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
    echo "SSL certificate not found. Generating self-signed certificate for development..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_DIR/privkey.pem" \
        -out "$SSL_DIR/fullchain.pem" \
        -subj "/CN=$DOMAIN_NAME/O=Omnichannel/OU=Dev"
fi

# Run the default Nginx entrypoint which handles template processing
exec /docker-entrypoint.sh "$@"
