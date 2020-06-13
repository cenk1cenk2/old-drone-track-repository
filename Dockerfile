FROM node:14-alpine

WORKDIR /data/app

ADD . /data/app

RUN chmod +x /data/app/run.sh

RUN yarn --frozen-lockfile --production

CMD ["/data/app/run.sh"]