#!/bin/bash

NFS="/Volumes/NFS-1"
SMB="/Volumes/SMB"
SIZE=512  # MB

to_mb() {
    echo "scale=2; $1 / 1048576" | bc
}

echo "=============================="
echo " BENCHMARK NFS vs SMB - $(date)"
echo "=============================="

for PROTO in NFS SMB; do
    if [ "$PROTO" = "NFS" ]; then DIR=$NFS; else DIR=$SMB; fi
    echo ""
    echo "--- $PROTO ---"

    echo -n "  Escritura: "
    WRITE_BPS=$(dd if=/dev/zero of=$DIR/bench.tmp bs=1m count=$SIZE 2>&1 \
        | awk '/bytes transferred/ {gsub(/[()bytes\/sec]/, "", $7); print $7}')
    echo "$(to_mb $WRITE_BPS) MB/s"

    sudo purge > /dev/null 2>&1

    echo -n "  Lectura:   "
    READ_BPS=$(dd if=$DIR/bench.tmp of=/dev/null bs=1m 2>&1 \
        | awk '/bytes transferred/ {gsub(/[()bytes\/sec]/, "", $7); print $7}')
    echo "$(to_mb $READ_BPS) MB/s"

    rm -f $DIR/bench.tmp
done

echo ""
echo "=============================="