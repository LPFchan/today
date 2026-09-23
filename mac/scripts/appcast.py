"""Adds a release to an appcast.xml, newest first. The feed lives on the
mac-appcast branch; .github/workflows/mac.yml checks it out and runs this.

usage: appcast.py FEED VERSION BUILD URL 'sparkle:edSignature="…" length="…"'
(the last argument is sign_update's output, pasted into the enclosure).
"""

import sys
from email.utils import formatdate
from pathlib import Path

path, version, build, url, signature = sys.argv[1:]
feed = Path(path)
if not feed.exists():
    feed.write_text("""<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>today</title>
    <link>https://raw.githubusercontent.com/LPFchan/today/mac-appcast/appcast.xml</link>
    <language>en</language>
  </channel>
</rss>
""")
item = f"""    <item>
      <title>Version {version}</title>
      <pubDate>{formatdate(usegmt=True)}</pubDate>
      <sparkle:version>{build}</sparkle:version>
      <sparkle:shortVersionString>{version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>https://github.com/LPFchan/today/releases/tag/mac-v{version}</sparkle:fullReleaseNotesLink>
      <enclosure url="{url}" type="application/octet-stream" {signature.strip()}/>
    </item>
"""
xml = feed.read_text()
at = xml.find("    <item>")
if at < 0:
    at = xml.index("  </channel>")
feed.write_text(xml[:at] + item + xml[at:])
