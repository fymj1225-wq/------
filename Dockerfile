# レストア原価管理 — 公開用イメージ
FROM node:22-alpine

WORKDIR /app
COPY . .

# データは消えないディスク（ボリューム）に置く
ENV DATA_DIR=/data
ENV RESTORE_PUBLIC=1
ENV PORT=8080
# RESTORE_TOKEN はホスト側の「シークレット」で渡すこと（ここには書かない）

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server.js"]
