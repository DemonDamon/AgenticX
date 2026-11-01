# yt-dlp Usage Examples

## Basic Downloads

### Download Best Quality
```bash
yt-dlp https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download as MP4
```bash
yt-dlp --merge-output-format mp4 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download to Specific Directory
```bash
yt-dlp -o "~/Videos/%(title)s.%(ext)s" https://www.youtube.com/watch?v=BaW_jenozKc
```

## Audio Extraction

### Extract Audio as MP3
```bash
yt-dlp -x --audio-format mp3 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Best Audio Quality
```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 https://www.youtube.com/watch?v=BaW_jenozKc
```

## Format Selection

### List Available Formats
```bash
yt-dlp -F https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download Specific Format
```bash
# Download format ID 137 (1080p video) + 140 (audio)
yt-dlp -f 137+140 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download Best Video + Best Audio
```bash
yt-dlp -f "bestvideo+bestaudio" https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download by Resolution
```bash
# 720p or lower
yt-dlp -f "best[height<=720]" https://www.youtube.com/watch?v=BaW_jenozKc

# 1080p
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" https://www.youtube.com/watch?v=BaW_jenozKc
```

## Subtitles

### Download with Subtitles
```bash
yt-dlp --write-subs https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download Specific Language Subtitles
```bash
# Chinese (Simplified)
yt-dlp --write-subs --sub-langs zh-Hans https://www.youtube.com/watch?v=BaW_jenozKc

# English
yt-dlp --write-subs --sub-langs en https://www.youtube.com/watch?v=BaW_jenozKc

# Multiple languages
yt-dlp --write-subs --sub-langs zh-Hans,en https://www.youtube.com/watch?v=BaW_jenozKc
```

### Download Subtitles Only
```bash
yt-dlp --write-subs --skip-download https://www.youtube.com/watch?v=BaW_jenozKc
```

### Embed Subtitles in Video
```bash
yt-dlp --write-subs --embed-subs https://www.youtube.com/watch?v=BaW_jenozKc
```

## Playlists and Channels

### Download Entire Playlist
```bash
yt-dlp https://www.youtube.com/playlist?list=PLxxx
```

### Download First 10 Videos from Playlist
```bash
yt-dlp --playlist-items 1-10 https://www.youtube.com/playlist?list=PLxxx
```

### Download Channel
```bash
yt-dlp https://www.youtube.com/@channelname
```

## Advanced Options

### Use Proxy
```bash
# HTTP proxy
yt-dlp --proxy http://127.0.0.1:8080 https://www.youtube.com/watch?v=BaW_jenozKc

# SOCKS5 proxy
yt-dlp --proxy socks5://127.0.0.1:1080 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Use Browser Cookies
```bash
# Chrome
yt-dlp --cookies-from-browser chrome https://www.youtube.com/watch?v=BaW_jenozKc

# Firefox
yt-dlp --cookies-from-browser firefox https://www.youtube.com/watch?v=BaW_jenozKc

# Specific profile
yt-dlp --cookies-from-browser chrome:Profile1 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Concurrent Downloads
```bash
yt-dlp --concurrent-fragments 8 https://www.youtube.com/watch?v=BaW_jenozKc
```

### Use External Downloader
```bash
# aria2c
yt-dlp --downloader aria2c https://www.youtube.com/watch?v=BaW_jenozKc

# With aria2c options
yt-dlp --downloader aria2c --downloader-args "aria2c:-x 16 -k 1M" https://www.youtube.com/watch?v=BaW_jenozKc
```

## Python API Examples

### Basic Download
```python
import yt_dlp

url = 'https://www.youtube.com/watch?v=BaW_jenozKc'

ydl_opts = {
    'format': 'bestvideo+bestaudio/best',
    'outtmpl': '%(title)s.%(ext)s',
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
```

### Extract Audio
```python
import yt_dlp

url = 'https://www.youtube.com/watch?v=BaW_jenozKc'

ydl_opts = {
    'format': 'm4a/bestaudio/best',
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
    }]
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
```

### Get Video Info
```python
import yt_dlp
import json

url = 'https://www.youtube.com/watch?v=BaW_jenozKc'

ydl_opts = {}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    print(f"Title: {info['title']}")
    print(f"Duration: {info['duration']} seconds")
    print(f"View count: {info['view_count']}")
```

### Download with Progress Hook
```python
import yt_dlp

def progress_hook(d):
    if d['status'] == 'downloading':
        print(f"Downloading: {d['_percent_str']} of {d['_total_bytes_str']}")
    elif d['status'] == 'finished':
        print('Download completed!')

url = 'https://www.youtube.com/watch?v=BaW_jenozKc'

ydl_opts = {
    'progress_hooks': [progress_hook],
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
```

## Bilibili Examples

### Download Bilibili Video
```bash
yt-dlp https://www.bilibili.com/video/BV1xx411c7mu
```

### Download with Cookies (for premium content)
```bash
yt-dlp --cookies-from-browser chrome https://www.bilibili.com/video/BV1xx411c7mu
```
