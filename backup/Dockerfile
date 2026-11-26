FROM postgres:17-alpine
RUN apk add --no-cache rclone curl tzdata
ENV RCLONE_CONFIG=/config/rclone/rclone.conf
COPY backup.sh restaurar.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restaurar.sh
CMD ["/usr/local/bin/backup.sh", "--agendado"]
