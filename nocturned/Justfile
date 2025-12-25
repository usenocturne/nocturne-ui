build:
    GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "-s -w" -o nocturned

copy: build
    scp ./nocturned root@172.16.42.2:/usr/sbin/nocturned
