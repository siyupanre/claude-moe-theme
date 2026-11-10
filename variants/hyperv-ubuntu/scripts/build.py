#!/usr/bin/env python3
"""Build the themed Claude copy from the installed official package.

The official package under /usr/lib/claude-desktop is only read, never modified. The copy keeps
the official binary byte for byte, symlinks every other file, and repacks app.asar so that its
entry point loads moe-bootstrap.cjs before the official main script. Every original packed file
is verified unchanged after the repack.
"""
import argparse, hashlib, json, os, pathlib, shutil, struct, sys, time

SOURCE = pathlib.Path('/usr/lib/claude-desktop')
OFFICIAL_MAIN = '.vite/build/index.pre.js'
ENTRY = 'moe-bootstrap.cjs'
PACKED = [ENTRY, 'startup-cover.cjs', 'chat-background.cjs']          # go into app.asar
ASSETS = ['chat-background.js', 'chat-background.jpg', 'chat-background.mp4', 'splash']  # go into resources/moe
BLOCK = 4 * 1024 * 1024


def sha(data): return hashlib.sha256(data).hexdigest()


def hashfile(path):
    with open(path, 'rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def stamp(path):
    st = path.stat()
    return f'{st.st_size}:{st.st_mtime_ns}'


def read_asar(path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[16:16 + size]), raw, 8 + struct.unpack_from('<I', raw, 4)[0]


def walk(node, prefix=''):
    for name, item in node.get('files', {}).items():
        key = prefix + name
        if 'files' in item: yield from walk(item, key + '/')
        else: yield key, item


def content(item, raw, base):
    start = base + int(item['offset'])
    return raw[start:start + item['size']]


def integrity(data):
    return {'algorithm': 'SHA256', 'hash': sha(data), 'blockSize': BLOCK,
            'blocks': [sha(data[i:i + BLOCK]) for i in range(0, len(data), BLOCK)] or [sha(b'')]}


def runtime_hash(runtime):
    digest = hashlib.sha256()
    for name in PACKED + ASSETS:
        path = runtime / name
        files = sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path]
        for f in files:
            digest.update(str(f.relative_to(runtime)).encode())
            digest.update(f.read_bytes())
    return digest.hexdigest()


def repack(source, destination, runtime):
    tree, raw, base = read_asar(source)
    original = {name: content(item, raw, base) for name, item in walk(tree) if 'offset' in item and not item.get('unpacked')}
    package = json.loads(original['package.json'])
    if package.get('main') != OFFICIAL_MAIN:
        raise RuntimeError(f"unexpected official entry {package.get('main')!r}; this build supports {OFFICIAL_MAIN}")
    package['main'] = ENTRY
    package['claudeMoe'] = {'originalMain': OFFICIAL_MAIN}
    changes = {'package.json': json.dumps(package, ensure_ascii=False, separators=(',', ':')).encode()}
    changes.update({name: (runtime / name).read_bytes() for name in PACKED})
    for name, data in changes.items():
        if name != 'package.json' and name in tree['files']: raise RuntimeError(f'{name} already exists in the official app.asar')
        tree['files'][name] = {'size': len(data), 'offset': '0', 'integrity': integrity(data)}
    payload = bytearray()
    for name, item in walk(tree):
        if item.get('unpacked') or 'link' in item: continue
        data = changes.get(name, original.get(name))
        if data is None: raise RuntimeError('missing packed file: ' + name)
        item['offset'] = str(len(payload)); item['size'] = len(data); payload.extend(data)
    header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode()
    pickled = struct.pack('<I', len(header)) + header
    pickled += b'\0' * ((-len(pickled)) % 4)
    pickled = struct.pack('<I', len(pickled)) + pickled
    destination.write_bytes(struct.pack('<II', 4, len(pickled)) + pickled + payload)
    # Read the result back: every original file but package.json must be identical, every added file present.
    check, updated, new_base = read_asar(destination)
    verified = 0
    for name, item in walk(check):
        if name in original and name != 'package.json':
            if content(item, updated, new_base) != original[name]: raise RuntimeError('repack changed ' + name)
            verified += 1
    for name, data in changes.items():
        if content(check['files'][name], updated, new_base) != data: raise RuntimeError('repack lost ' + name)
    return package['version'], verified


def build(prefix, runtime):
    source_asar = SOURCE / 'resources' / 'app.asar'
    staging, app_dir, old = prefix / 'app.new', prefix / 'app', prefix / 'app.old'
    for leftover in (staging, old):
        if leftover.exists(): shutil.rmtree(leftover)
    staging.mkdir(parents=True)
    shutil.copy2(SOURCE / 'claude-desktop', staging / 'claude-desktop')
    for entry in SOURCE.iterdir():
        if entry.name not in ('claude-desktop', 'resources'): (staging / entry.name).symlink_to(entry)
    resources = staging / 'resources'
    resources.mkdir()
    for entry in (SOURCE / 'resources').iterdir():
        if entry.name != 'app.asar': (resources / entry.name).symlink_to(entry)
    version, verified = repack(source_asar, resources / 'app.asar', runtime)
    moe = resources / 'moe'
    moe.mkdir()
    for name in ASSETS:
        src = runtime / name
        if src.is_dir(): shutil.copytree(src, moe / name)
        else: shutil.copy2(src, moe / name)
    if hashfile(staging / 'claude-desktop') != hashfile(SOURCE / 'claude-desktop'): raise RuntimeError('binary copy differs')
    if app_dir.exists(): app_dir.rename(old)
    staging.rename(app_dir)
    if old.exists(): shutil.rmtree(old)
    info = {'version': version, 'sourceBinary': stamp(SOURCE / 'claude-desktop'), 'sourceAsar': stamp(source_asar),
            'runtime': runtime_hash(runtime), 'asarSha256': hashfile(app_dir / 'resources' / 'app.asar'),
            'verifiedOriginalFiles': verified, 'builtAt': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    tmp = prefix / 'build-info.json.tmp'
    tmp.write_text(json.dumps(info, indent=1))
    tmp.replace(prefix / 'build-info.json')
    return info


def copy_running(prefix):
    """True while any process runs the themed binary; its files must not be swapped underneath it."""
    app = str(prefix / 'app')
    for pid in filter(str.isdigit, os.listdir('/proc')):
        try: exe = os.readlink(f'/proc/{pid}/exe')
        except OSError: continue
        if exe.startswith((app + '/', app + '.old/')): return True
    return False


def up_to_date(prefix, runtime):
    try: info = json.loads((prefix / 'build-info.json').read_text())
    except (OSError, ValueError): return False, 'no build yet'
    asar = prefix / 'app' / 'resources' / 'app.asar'
    if info.get('sourceBinary') != stamp(SOURCE / 'claude-desktop') or info.get('sourceAsar') != stamp(SOURCE / 'resources' / 'app.asar'):
        return False, 'official app changed'
    if info.get('runtime') != runtime_hash(runtime): return False, 'theme files changed'
    if not asar.is_file() or hashfile(asar) != info.get('asarSha256'): return False, 'themed app.asar missing or modified'
    return True, 'up to date'


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--prefix', type=pathlib.Path, default=pathlib.Path.home() / '.local/share/claude-moe')
    parser.add_argument('--runtime', type=pathlib.Path, help='theme files (default: <prefix>/runtime)')
    parser.add_argument('--force', action='store_true', help='rebuild even when up to date')
    parser.add_argument('--quiet', action='store_true', help='print nothing when up to date')
    args = parser.parse_args()
    if os.getuid() == 0: sys.exit('claude-moe: run as your normal user, not root')
    prefix = args.prefix.expanduser().resolve()
    runtime = (args.runtime or prefix / 'runtime').expanduser().resolve()
    current, reason = up_to_date(prefix, runtime)
    if current and not args.force:
        if not args.quiet: print('claude-moe:', reason)
        return
    if copy_running(prefix):
        print(f'claude-moe: not rebuilding ({reason}) while the themed Claude is running; quit it and start again', file=sys.stderr)
        sys.exit(2)
    print(f'claude-moe: building ({reason})', file=sys.stderr)
    info = build(prefix, runtime)
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'claude-moe: build failed: {error}', file=sys.stderr)
        sys.exit(1)
