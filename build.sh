#!/usr/bin/env bash
# Render deployment script

echo "Installing Node Dependencies..."
npm install

echo "Checking for Python 3 (required by yt-dlp)..."
if ! command -v python3 &> /dev/null
then
    echo "Python 3 not found. Installing python3-minimal..."
    apt-get update && apt-get install -y python3-minimal
else
    echo "Python 3 is already installed."
fi

echo "Build complete."
