FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY db ./db
COPY srv ./srv
COPY app ./app
ENV INSIGHTS_URL=http://ml:5001/analyze
EXPOSE 4004
CMD ["npx", "cds-serve"]
