# Build from the repository root after `node build.mjs`.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /opt/training
COPY backend/ ./backend/
COPY data/personas.json ./data/personas.json
# server.mjs imports training-session.mjs, which reads this file at startup.
COPY data/training-scenarios.json ./data/training-scenarios.json
COPY data/ocean-taxonomy.json ./data/ocean-taxonomy.json
COPY server.mjs ./server.mjs
COPY index.html ./index.html
COPY chamber.html ./chamber.html
COPY ui/desktop/ ./ui/desktop/
COPY ocean-style-prototypes/retrodiffusion-creature-animation/manifest.json ./ocean-style-prototypes/retrodiffusion-creature-animation/manifest.json
COPY ocean-style-prototypes/retrodiffusion-creature-animation/animations/*-256.gif ./ocean-style-prototypes/retrodiffusion-creature-animation/animations/

# Keep the installed Playwright package aligned with the image's Chromium version.
RUN npm install --no-save --omit=dev --no-audit --no-fund playwright@1.55.0

ENV NODE_ENV=production
ENV ENABLE_TEMPLATE_DESKTOPS=false
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
ENTRYPOINT ["node", "/opt/training/backend/browser-runner-entry.mjs"]
