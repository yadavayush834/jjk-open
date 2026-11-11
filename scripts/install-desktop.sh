#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
node --version
if [ ! -d node_modules ]; then npm ci; fi
npm run build
python - "$PWD" <<'PY'
from pathlib import Path
import sys,shutil
project=Path(sys.argv[1]); home=Path.home()
node=shutil.which('node')
def unit_quote(text):
    return '"'+str(text).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
units=home/'.config/systemd/user'; units.mkdir(parents=True,exist_ok=True)
(units/'limitless.service').write_text('\n'.join([
    '[Unit]','Description=Limitless cursed technique playground','After=network.target','',
    '[Service]','Type=simple','WorkingDirectory='+str(project).replace('%','%%'),
    'ExecStart='+unit_quote(node)+' '+unit_quote(project/'node_modules/vite/bin/vite.js')+' preview --host 127.0.0.1 --port 5010',
'Restart=on-failure','RestartSec=3',
    'UMask=0077','',
])+'\n')
bin_dir=home/'.local/bin'; bin_dir.mkdir(parents=True,exist_ok=True)
launcher=bin_dir/'limitless'
launcher.write_text('''#!/usr/bin/env bash
set -euo pipefail
systemctl --user start limitless.service
for attempt in {1..40}; do
    if curl --fail --silent http://localhost:5010/ >/dev/null; then
        exec xdg-open http://localhost:5010
    fi
    sleep 0.1
done
printf 'Limitless did not start. Check: journalctl --user -u limitless.service\\n' >&2
exit 1
''')
launcher.chmod(0o755)
apps=home/'.local/share/applications';apps.mkdir(parents=True,exist_ok=True)
(apps/'limitless.desktop').write_text('\n'.join([
    '[Desktop Entry]','Type=Application','Name=Limitless','Comment=Jujutsu Kaisen inspired technique playground',
    'Exec="'+str(launcher).replace('"','\\"')+'"','Icon='+str(project/'public/favicon.svg'),
    'Terminal=false','Categories=Game;Graphics;',
])+'\n')
PY
systemctl --user daemon-reload
printf 'Installed Limitless in your app launcher. Run limitless to open it.\n'
