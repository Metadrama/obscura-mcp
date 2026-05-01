FROM node:20-alpine

# Install obscura-mcp globally (postinstall downloads Obscura binary)
RUN npm install -g obscura-mcp

# Expose HTTP port for streamable-http transport
EXPOSE 3000

# Default: stdio transport (MCP standard)
ENTRYPOINT ["obscura-mcp"]
CMD []
