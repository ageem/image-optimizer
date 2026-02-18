import os
import io
import glob
from flask import Flask, render_template, request, jsonify, send_file, Response
from PIL import Image

app = Flask(__name__)

SUPPORTED_FORMATS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/favicon.ico')
def favicon():
    return '', 204


@app.route('/preview')
def preview():
    """Serve a resized thumbnail of any local image file."""
    path = request.args.get('path', '')
    if not path or not os.path.isfile(path):
        return Response('Not found', status=404)
    try:
        with Image.open(path) as img:
            img.thumbnail((400, 300), Image.LANCZOS)
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=75)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg')
    except Exception as e:
        return Response(str(e), status=500)


@app.route('/scan-folder', methods=['POST'])
def scan_folder():
    data = request.json
    folder_path = data.get('folder', '').strip()

    if not folder_path or not os.path.isdir(folder_path):
        return jsonify({'error': f'Folder not found: {folder_path}'}), 400

    images = []
    seen = set()
    for ext in SUPPORTED_FORMATS:
        for filepath in (
            glob.glob(os.path.join(folder_path, f'*{ext}')) +
            glob.glob(os.path.join(folder_path, f'*{ext.upper()}'))
        ):
            if filepath in seen:
                continue
            seen.add(filepath)
            try:
                with Image.open(filepath) as img:
                    w, h = img.size
                    size_kb = round(os.path.getsize(filepath) / 1024)
                    images.append({
                        'path': filepath,
                        'name': os.path.basename(filepath),
                        'width': w,
                        'height': h,
                        'size_kb': size_kb,
                        'format': img.format or ext[1:].upper()
                    })
            except Exception:
                pass

    images.sort(key=lambda x: x['name'].lower())
    return jsonify({'images': images, 'folder': folder_path})


@app.route('/resolve-files', methods=['POST'])
def resolve_files():
    """
    Accepts files uploaded via drag-and-drop or file picker.
    Paths are sent as form fields alongside the file bytes.
    """
    files = request.files.getlist('files')
    paths = request.form.getlist('paths[]')

    if not files:
        return jsonify({'error': 'No files received'}), 400

    images = []
    folder = None

    for i, f in enumerate(files):
        real_path = paths[i].strip() if i < len(paths) else ''

        if real_path and os.path.isfile(real_path):
            try:
                with Image.open(real_path) as img:
                    w, h = img.size
                    size_kb = round(os.path.getsize(real_path) / 1024)
                    images.append({
                        'path': real_path,
                        'name': os.path.basename(real_path),
                        'width': w,
                        'height': h,
                        'size_kb': size_kb,
                        'format': img.format or os.path.splitext(real_path)[1][1:].upper()
                    })
                    if folder is None:
                        folder = os.path.dirname(real_path)
            except Exception:
                pass
        else:
            # Fallback: read from uploaded bytes — no real path available
            try:
                img_bytes = f.read()
                with Image.open(io.BytesIO(img_bytes)) as img:
                    w, h = img.size
                    ext = os.path.splitext(f.filename)[1]
                    images.append({
                        'path': '',
                        'name': f.filename,
                        'width': w,
                        'height': h,
                        'size_kb': round(len(img_bytes) / 1024),
                        'format': img.format or ext[1:].upper(),
                        'no_path': True
                    })
            except Exception:
                pass

    images.sort(key=lambda x: x['name'].lower())
    return jsonify({'images': images, 'folder': folder})


@app.route('/resolve-paths', methods=['POST'])
def resolve_paths():
    """
    Given a list of filenames and a folder hint, return full resolved paths.
    Used when the browser can't provide real filesystem paths (drag-and-drop).
    """
    data = request.json
    filenames = data.get('filenames', [])
    folder = data.get('folder', '').strip()

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': f'Folder not found: {folder}'}), 400

    resolved = {}
    for name in filenames:
        candidate = os.path.join(folder, name)
        if os.path.isfile(candidate):
            resolved[name] = candidate

    return jsonify({'resolved': resolved, 'folder': folder})


@app.route('/convert', methods=['POST'])
def convert():
    data         = request.json
    jobs         = data.get('jobs', [])
    output_suffix = data.get('output_suffix', '-optimized')
    output_folder = data.get('output_folder', '').strip()
    overwrite    = data.get('overwrite', False)
    results      = []

    for job in jobs:
        filepath      = job['path']
        target_width  = job.get('width')
        quality       = job.get('quality', 85)
        output_format = job.get('format', 'original').lower()
        skip          = job.get('skip', False)
        no_path       = job.get('no_path', False)

        if skip:
            results.append({'name': os.path.basename(filepath) if filepath else job.get('name',''), 'status': 'skipped'})
            continue

        if no_path or not filepath:
            results.append({'name': job.get('name', '?'), 'status': 'error',
                            'error': 'No file path available. Use the folder path field to load images.'})
            continue

        if not os.path.isfile(filepath):
            results.append({'name': os.path.basename(filepath), 'status': 'error', 'error': 'File not found on disk'})
            continue

        try:
            with Image.open(filepath) as img:
                orig_w, orig_h = img.size

                # Resize
                if target_width and int(target_width) > 0 and int(target_width) != orig_w:
                    tw    = int(target_width)
                    ratio = tw / orig_w
                    th    = int(orig_h * ratio)
                    img   = img.resize((tw, th), Image.LANCZOS)

                # Determine output format & extension
                base, orig_ext = os.path.splitext(os.path.basename(filepath))
                if output_format == 'original':
                    out_ext     = orig_ext.lower()
                    save_format = (img.format or 'JPEG').upper()
                    if save_format not in ('JPEG', 'PNG', 'WEBP', 'GIF', 'BMP', 'TIFF'):
                        save_format = 'JPEG'
                elif output_format == 'webp':
                    out_ext     = '.webp'
                    save_format = 'WEBP'
                elif output_format == 'jpg':
                    out_ext     = '.jpg'
                    save_format = 'JPEG'
                elif output_format == 'png':
                    out_ext     = '.png'
                    save_format = 'PNG'
                else:
                    out_ext     = orig_ext.lower()
                    save_format = 'JPEG'

                # Build output path
                if overwrite:
                    # Overwrite original — keep its exact path (format may change extension)
                    out_path = os.path.join(os.path.dirname(filepath), base + out_ext)
                else:
                    out_filename = f"{base}{output_suffix}{out_ext}"
                    if output_folder and os.path.isdir(output_folder):
                        out_path = os.path.join(output_folder, out_filename)
                    else:
                        out_path = os.path.join(os.path.dirname(filepath), out_filename)

                # Save
                if save_format == 'PNG':
                    if img.mode not in ('RGB', 'RGBA'):
                        img = img.convert('RGBA')
                    img.save(out_path, 'PNG', optimize=True)
                else:
                    if img.mode in ('RGBA', 'P', 'LA'):
                        img = img.convert('RGB')
                    img.save(out_path, save_format, quality=int(quality), optimize=True)

                out_size_kb = round(os.path.getsize(out_path) / 1024)
                results.append({
                    'name':     os.path.basename(filepath),
                    'output':   out_path,
                    'status':   'ok',
                    'size_kb':  out_size_kb
                })

        except Exception as e:
            results.append({'name': os.path.basename(filepath), 'status': 'error', 'error': str(e)})

    return jsonify({'results': results})


if __name__ == '__main__':
    import threading, time, webbrowser

    def open_browser():
        time.sleep(1.2)
        webbrowser.open('http://localhost:5050')

    threading.Thread(target=open_browser, daemon=True).start()
    app.run(port=5050, debug=False)
