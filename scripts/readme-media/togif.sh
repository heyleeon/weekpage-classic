#!/bin/bash
# togif.sh <name> <trim> <dur> [width] — vid/<name>.webm → out/<name>.gif (gifski if present, else ffmpeg palette)
set -e
name=$1; trim=$2; dur=$3; w=${4:-1040}
cd "$(dirname "$0")"
if command -v gifski >/dev/null; then
  rm -rf frames/$name && mkdir -p frames/$name
  ffmpeg -v error -ss "$trim" -t "$dur" -i vid/$name.webm -vf "fps=${FPS:-20},scale=$w:-1:flags=lanczos" frames/$name/f%04d.png
  gifski --fps ${FPS:-20} --quality 85 -o out/$name.gif frames/$name/f*.png >/dev/null
else
  ffmpeg -v error -y -ss "$trim" -t "$dur" -i vid/$name.webm -vf "fps=16,scale=$w:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" out/$name.gif
fi
ls -la out/$name.gif
