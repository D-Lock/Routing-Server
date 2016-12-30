FROM node:boron-alpine

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY app/package.json /usr/src/app
RUN npm install

EXPOSE 1337
CMD [ "npm", "start" ]