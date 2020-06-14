FROM node:14-alpine

WORKDIR /data/app

ADD . /data/app

RUN apk add --no-cache --no-progress git

RUN chmod +x /data/app/run.sh

RUN yarn --frozen-lockfile --production

CMD ["/data/app/run.sh"]