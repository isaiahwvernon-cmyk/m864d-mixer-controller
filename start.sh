#!/bin/bash
echo "=========================================="
echo "  M-864D Mixer Controller"
echo "=========================================="
echo

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install it from https://nodejs.org"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies... this may take a minute."
    echo
    npm install
    echo
fi

if [ ! -f "dist/.m864d-build" ]; then
    echo "Building app for the first time... this takes about 30 seconds."
    echo "(If you had an older version installed, this will replace it.)"
    echo
    npx tsx script/build.ts
    if [ $? -ne 0 ]; then
        echo
        echo "ERROR: Build failed. See above for details."
        echo "Try deleting the 'dist' folder and running again."
        exit 1
    fi
    echo
    echo "Build complete!"
    echo
fi

echo "Starting server..."
echo
echo "Mixer control panel:  http://localhost:5000"
echo
echo "Tablets and phones on the same Wi-Fi network can also connect."
echo "Press Ctrl+C to stop the server."
echo "=========================================="
echo

(sleep 4 && open "http://localhost:5000" 2>/dev/null || xdg-open "http://localhost:5000" 2>/dev/null; sleep 1 && open "http://localhost:5000/connect" 2>/dev/null || xdg-open "http://localhost:5000/connect" 2>/dev/null) &

node dist/index.cjs
