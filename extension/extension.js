import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/*
 * Thin loader. GNOME Shell caches ES modules for the life of the process, so editing the UI
 * used to require logging out. Instead every enable imports a uniquely named copy of pub-ui.js
 * from $XDG_RUNTIME_DIR, which the module cache has never seen.
 *
 * Changing this loader itself still needs one logout.
 */
const UI_FILE = 'pub-ui.js';
const COPY_DIR = 'pub-ui';

export default class PubExtension extends Extension {
    enable() {
        this._generation = (this._generation ?? 0) + 1;
        this._start(this._generation);
    }

    disable() {
        this._generation = (this._generation ?? 0) + 1;
        try {
            this._runtime?.disable();
        } catch (error) {
            console.error('PUB: runtime disable failed', error);
        }
        this._runtime = null;
    }

    /** Re-read pub-ui.js and stylesheet.css from disk without restarting GNOME Shell. */
    reload() {
        this.disable();
        this._reloadStylesheet();
        this.enable();
    }

    async _start(generation) {
        try {
            const module = await import(this._freshCopyUri());
            if (generation !== this._generation)
                return;
            this._runtime = new module.PubRuntime(this);
            this._runtime.enable();
        } catch (error) {
            console.error('PUB: could not load UI', error);
        }
    }

    _freshCopyUri() {
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), COPY_DIR]);
        GLib.mkdir_with_parents(dir, 0o700);
        this._pruneCopies(dir);
        const copy = Gio.File.new_for_path(GLib.build_filenamev([dir, `pub-ui-${GLib.get_real_time()}.js`]));
        this.dir.get_child(UI_FILE).copy(copy, Gio.FileCopyFlags.OVERWRITE, null, null);
        return copy.get_uri();
    }

    _pruneCopies(dir) {
        try {
            const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.startsWith('pub-ui-') && name.endsWith('.js'))
                    enumerator.get_child(info).delete(null);
            }
            enumerator.close(null);
        } catch (_error) {
            // stale copies are harmless
        }
    }

    _reloadStylesheet() {
        const file = this.dir.get_child('stylesheet.css');
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        try {
            theme.unload_stylesheet(file);
        } catch (_error) {
            // not loaded yet
        }
        try {
            theme.load_stylesheet(file);
            this.stylesheet = file;
        } catch (error) {
            console.error('PUB: could not reload stylesheet', error);
        }
    }
}
