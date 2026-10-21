# Synthetic attack runner image. Build with the runner directory as the context:
#   docker build -f deploy/sandbox/Dockerfile -t blast-radius-sandbox:local backend/sandbox
# Run only through backend/sandbox/controller.mjs (see docs/desktop-parity/SANDBOX.md): it adds
# --network none --read-only --tmpfs /work --cap-drop ALL --memory --pids-limit --cpus and a non-root user.
FROM node:22-alpine

LABEL org.blast-radius-zero.role="synthetic-attack-runner"

WORKDIR /opt/sandbox
COPY kinds.mjs runner.mjs ./
RUN printf '{"type":"module"}\n' > package.json

ENV NODE_ENV=production \
    SANDBOX_WORKDIR=/work \
    SANDBOX_REQUIRE_NO_NETWORK=1
USER 10001:10001
ENTRYPOINT ["node", "/opt/sandbox/runner.mjs"]
