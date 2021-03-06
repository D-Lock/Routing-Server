FROM dloc/dloc-configured:latest

RUN apt-get update && apt-get install -y \
  nodejs \
  npm \
  git \
  git-core \
  && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN ln -s `which nodejs` /usr/bin/node

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY app/package.json /usr/src/app
RUN npm install

COPY app/ /usr/src/app

EXPOSE 1337
CMD [ "npm", "start" ]