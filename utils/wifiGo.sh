echo 2 > /sys/module/bcmdhd/parameters/op_mode

echo /lib/firmware/bcm/fw_bcmdhd.bin > /sys/module/bcmdhd/parameters/firmware_path
echo /lib/firmware/bcm/bcmdhd.cal > /sys/module/bcmdhd/parameters/nvram_path
ifconfig wlan0 192.168.1.1 up
udhcpd -S -I 192.168.1.1 /etc/udhcpd.conf
hostapd -B /etc/hostapd.conf
