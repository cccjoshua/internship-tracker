"""Durable, atomic file writes shared by server.py, fetcher.py and ai.py.

write -> flush -> fsync the temp file -> rename over the target -> fsync the folder.
After a crash or power loss the target is either the old file or the new one, never empty or half written.
A failed write removes its temp file. Uses only the standard library.
"""
import json
import os
import tempfile


def _fsync_dir(folder):
    try:
        fd = os.open(folder, os.O_RDONLY)
    except OSError:
        return  # some platforms cannot open folders; the rename is still atomic
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def write_bytes(path, data, private=False):
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-", suffix=os.path.splitext(path)[1])
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if private:
            os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    _fsync_dir(folder)


def write_json(path, obj, indent=None, private=False):
    write_bytes(path, json.dumps(obj, ensure_ascii=False, indent=indent).encode("utf-8"), private=private)
