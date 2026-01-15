#!/bin/bash

if command -v python3 &> /dev/null
then
    py_executable="python3"
elif command -v python &> /dev/null
then
    py_executable="python"
else
    echo "Python is needed to install PiTunnel."
    echo "You can install Python with:"
    echo "  sudo apt install python3"
    exit
fi

if command -v curl &> /dev/null
then
    curl -sL https://www.pitunnel.com/install/hkCTyVvkpD | $py_executable
elif command -v wget &> /dev/null
then
    wget -qO- https://www.pitunnel.com/install/hkCTyVvkpD | $py_executable
else
    echo "Installation failed"
fi