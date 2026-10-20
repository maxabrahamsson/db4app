#!/bin/bash
# Script to generate Tauri app icons from a source square logo
# Usage: ./generate-icons.sh <source-image.png>

set -e

ICONS_DIR="$(dirname "$0")/icons"
SOURCE_IMAGE="$1"

if [ -z "$SOURCE_IMAGE" ]; then
    echo "Usage: $0 <source-image.png>"
    echo "Example: $0 icons/square-logo.png"
    exit 1
fi

if [ ! -f "$SOURCE_IMAGE" ]; then
    echo "Error: Source image not found: $SOURCE_IMAGE"
    exit 1
fi

echo "Generating Tauri icons from: $SOURCE_IMAGE"

# Generate PNG icons at required sizes
echo "Generating PNG icons..."
sips -z 32 32 "$SOURCE_IMAGE" --out "$ICONS_DIR/32x32.png"
sips -z 128 128 "$SOURCE_IMAGE" --out "$ICONS_DIR/128x128.png"
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONS_DIR/128x128@2x.png"

# Copy source as icon.png (Tauri may use this as fallback)
cp "$SOURCE_IMAGE" "$ICONS_DIR/icon.png"

# Generate .icns file for macOS
echo "Generating macOS .icns file..."
# Create temporary iconset directory
ICONSET_DIR="$ICONS_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Generate all required sizes for .icns
sips -z 16 16 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_16x16.png"
sips -z 32 32 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 32 32 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_32x32.png"
sips -z 64 64 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_32x32@2x.png"
sips -z 128 128 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_128x128.png"
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_128x128@2x.png"
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_256x256.png"
sips -z 512 512 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_256x256@2x.png"
sips -z 512 512 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_512x512.png"
sips -z 1024 1024 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_512x512@2x.png"

# Create .icns file
iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
rm -rf "$ICONSET_DIR"

# Generate .ico file for Windows (using sips to create a multi-resolution ICO)
# Note: macOS sips doesn't directly create .ico, so we'll create a basic one
# For better Windows icon support, you might want to use an online converter or ImageMagick
echo "Generating Windows .ico file..."
# Create a temporary 256x256 PNG for the ICO
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONS_DIR/temp_ico.png"
# Note: For proper .ico generation, you may need ImageMagick or an online tool
# For now, we'll copy the 256x256 as a placeholder
# You can convert this manually using: convert temp_ico.png icon.ico (if ImageMagick is installed)
if command -v convert &> /dev/null; then
    convert "$ICONS_DIR/temp_ico.png" "$ICONS_DIR/icon.ico"
    rm "$ICONS_DIR/temp_ico.png"
else
    echo "Warning: ImageMagick not found. .ico file not generated."
    echo "You can manually convert $ICONS_DIR/temp_ico.png to icon.ico using an online tool."
    echo "Or install ImageMagick: brew install imagemagick"
fi

echo "✅ Icon generation complete!"
echo "Generated files:"
echo "  - 32x32.png"
echo "  - 128x128.png"
echo "  - 128x128@2x.png"
echo "  - icon.png"
echo "  - icon.icns (macOS)"
if [ -f "$ICONS_DIR/icon.ico" ]; then
    echo "  - icon.ico (Windows)"
fi

