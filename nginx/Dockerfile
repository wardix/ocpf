FROM nginx:alpine

# Install openssl to allow generating self-signed certificates
RUN apk add --no-cache openssl

# Copy configuration templates
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Copy entrypoint script to generate self-signed certs if missing
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
