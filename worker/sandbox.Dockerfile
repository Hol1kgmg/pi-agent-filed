FROM node:24-trixie-slim

COPY sandbox-packages.txt /tmp/sandbox-packages.txt
RUN apt-get update \
    && xargs apt-get install -y --no-install-recommends < /tmp/sandbox-packages.txt \
    && rm -rf /var/lib/apt/lists/*

# pi-env は worker の package.json と同じ版に固定する
ARG PI_ENV_VERSION=1.5.0
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) arch=x64; sha=55419f4fa1e7059f52540a2035ca68e90cc2c3ac49b637a7134c0200c2ab3381 ;; \
      arm64) arch=arm64; sha=e967fe64bd3f765f5e5ce9d3b83bfebcda24b5e929b82d93491b0803048d0ad5 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/pi-env "https://unpkg.com/@earendil-works/pi-env@${PI_ENV_VERSION}/bin/pi-env-linux-${arch}/pi-env"; \
    echo "${sha}  /usr/local/bin/pi-env" | sha256sum -c -; \
    chmod 755 /usr/local/bin/pi-env

WORKDIR /workspace
CMD ["sleep", "infinity"]
