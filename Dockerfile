FROM ubuntu:latest

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  nodejs \
  npm \
  git \
  git-core \
  && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN pip3 install boto3

RUN ln -s `which nodejs` /usr/bin/node

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY app/package.json /usr/src/app
RUN npm install

COPY app/ /usr/src/app

EXPOSE 1337
CMD [ "npm", "start" ]