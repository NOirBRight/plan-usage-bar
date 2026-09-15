/*
 * PUB UI runtime. Loaded by extension.js from a fresh copy on every enable, so edits here
 * take effect after `gnome-extensions disable/enable` or the context menu's 「重新加载」, without logging out.
 * Nothing in this file may rely on import.meta.url pointing at the extension directory.
 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const LOGIN_WAIT_SECONDS = 300;
const PROVIDER_NAMES = {
    claude: 'Claude',
    codex: 'Codex',
    cursor: 'Cursor',
    grok: 'Grok',
    'ollama-cloud': 'Ollama Cloud',
    'opencode-go': 'OpenCode Go',
    commandcode: 'Command Code',
};
const USAGE_URLS = {
    claude: 'https://claude.ai/settings/usage',
    codex: 'https://chatgpt.com/#settings',
    cursor: 'https://cursor.com/dashboard',
    grok: 'https://grok.com/?_s=usage',
    'ollama-cloud': 'https://ollama.com',
    'opencode-go': 'https://opencode.ai',
    commandcode: 'https://commandcode.ai/usage',
};
const DEFAULT_SETTINGS = {
    remainingMode: true,
    providers: [
        { id: 'claude', enabled: true, pinned: true },
        { id: 'codex', enabled: true, pinned: true },
        { id: 'cursor', enabled: true, pinned: true },
        { id: 'grok', enabled: true, pinned: true },
        { id: 'ollama-cloud', enabled: true, pinned: false },
        { id: 'opencode-go', enabled: true, pinned: false },
        { id: 'commandcode', enabled: true, pinned: false },
    ],
};
/*
 * How each Provider signs in.
 * cli    — the official CLI owns a browser OAuth flow and writes a file the Engine already reads.
 * cookie — no public auth API; the user copies a browser cookie.
 * key    — an API key created on the provider's site.
 */
const LOGIN = {
    claude: {
        kind: 'cli', cli: 'Claude Code', bin: 'claude', args: ['auth', 'login'],
        file: '~/.claude/.credentials.json', hint: 'Claude access token',
        // When the localhost callback is not used, claude.ai shows a code the CLI reads from stdin as "code#state".
        codeEntry: { hint: '粘贴浏览器页面上的授权码', invalid: /invalid code/iu },
    },
    codex: {
        kind: 'cli', cli: 'Codex CLI', bin: 'codex', args: ['login'],
        file: '~/.codex/auth.json', hint: 'Codex access token',
        extra: { key: 'accountId', hint: 'Codex account ID', required: true },
    },
    grok: {
        kind: 'cli', cli: 'Grok CLI', bin: 'grok', args: ['login', '--oauth'],
        file: '~/.grok/auth.json', hint: 'Grok API key / access token',
    },
    cursor: {
        kind: 'cli', cli: 'Cursor Agent', bin: 'cursor-agent', args: ['login'],
        file: '~/.config/cursor/auth.json',
        hint: 'WorkosCursorSessionToken 或 Cursor JWT',
        extra: { key: 'userId', hint: 'Cursor user ID（token 已含时留空）', required: false },
        page: 'https://cursor.com/dashboard', pageLabel: 'cursor.com',
    },
    'ollama-cloud': {
        kind: 'key', page: 'https://ollama.com/settings/keys', pageLabel: 'ollama.com',
        hint: 'Ollama API key',
    },
    'opencode-go': {
        kind: 'key', page: 'https://opencode.ai/auth', pageLabel: 'opencode.ai',
        hint: 'OpenCode Go API key',
        cli: 'OpenCode', bin: 'opencode', args: ['auth', 'login'],
        file: '~/.local/share/opencode/auth.json',
    },
    commandcode: {
        kind: 'key', page: 'https://commandcode.ai/studio', pageLabel: 'Studio',
        hint: 'Command Code API key',
        cli: 'Command Code', bin: 'cmd', args: ['login'],
        file: '~/.commandcode/auth.json',
    },
};
const FILL = { ok: '-st-accent-color', warn: '#e5a50a', crit: '#e01b24', none: 'transparent' };

function hasValue(remaining) {
    return remaining !== null && remaining !== undefined;
}

function pctText(remaining, remainingMode) {
    if (!hasValue(remaining))
        return '—';
    return `${Math.round((remainingMode ? remaining : 1 - remaining) * 100)}%`;
}

function shownFraction(remaining, remainingMode) {
    if (!hasValue(remaining))
        return 0;
    return remainingMode ? remaining : 1 - remaining;
}

function tone(remaining) {
    if (!hasValue(remaining))
        return 'none';
    if (remaining <= 0.05)
        return 'crit';
    if (remaining <= 0.20)
        return 'warn';
    return 'ok';
}

function toneClass(remaining) {
    const value = tone(remaining);
    return value === 'warn' || value === 'crit' ? ` pub-t-${value}` : '';
}

function primaryWindow(provider) {
    const windows = provider?.windows ?? [];
    return windows.find(window => window.primary) ?? windows[0] ?? null;
}

function snapshotErrorKind(provider) {
    if (provider?.errorKind)
        return provider.errorKind;
    if (provider?.error === 'signed out')
        return 'signed-out';
    if (provider?.error === 'HTTP 429')
        return 'rate-limit';
    if (typeof provider?.error === 'string' && provider.error.length > 0)
        return 'transport';
    return null;
}

function isSignedOut(provider) {
    return snapshotErrorKind(provider) === 'signed-out';
}

function hasFetchError(provider) {
    return snapshotErrorKind(provider) !== null;
}

function errorText(provider) {
    const kind = snapshotErrorKind(provider);
    if (kind === null)
        return '';
    if (kind === 'signed-out')
        return '未登录';
    if (kind === 'rate-limit')
        return '抓取失败 · 请求过于频繁（HTTP 429）';
    const error = provider?.error;
    return typeof error === 'string' && error.length > 0 ? `抓取失败 · ${error}` : '抓取失败';
}

function splitUserToken(value) {
    const index = String(value).indexOf('::');
    if (index <= 0 || index === value.length - 2)
        return null;
    const userId = value.slice(0, index).trim();
    const token = value.slice(index + 2).trim();
    if (userId.length === 0 || token.length === 0)
        return null;
    return { userId, token };
}

function userIdFromJwt(token) {
    const parts = String(token).split('.');
    if (parts.length < 2)
        return null;
    try {
        let b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
        while (b64.length % 4)
            b64 += '=';
        const payload = JSON.parse(new TextDecoder().decode(GLib.base64_decode(b64)));
        const sub = payload?.sub;
        if (typeof sub !== 'string')
            return null;
        const user = sub.includes('|') ? sub.slice(sub.lastIndexOf('|') + 1) : sub;
        return user.startsWith('user_') ? user : null;
    } catch (_error) {
        return null;
    }
}

function canonicalizeCredential(item, id) {
    if (!item || typeof item.token !== 'string' || item.token.trim().length === 0)
        return null;
    let token = item.token.trim();
    if (id === 'cursor')
        token = token.replace(/^WorkosCursorSessionToken=/iu, '').trim();
    const credential = { token };
    if (typeof item.accountId === 'string' && item.accountId.trim().length > 0)
        credential.accountId = item.accountId.trim();
    if (typeof item.userId === 'string' && item.userId.trim().length > 0)
        credential.userId = item.userId.trim();
    if (typeof item.plan === 'string' && item.plan.trim().length > 0)
        credential.plan = item.plan.trim();
    const split = splitUserToken(credential.token);
    if (credential.userId === undefined && split) {
        credential.userId = split.userId;
        credential.token = split.token;
    }
    if (credential.userId === undefined && id === 'cursor') {
        const fromJwt = userIdFromJwt(credential.token);
        if (fromJwt)
            credential.userId = fromJwt;
    }
    return credential;
}

function credentialComplete(id, credential) {
    if (!credential || typeof credential.token !== 'string' || credential.token.length === 0)
        return false;
    if (id === 'codex' && !credential.accountId)
        return false;
    if (id === 'cursor' && !credential.userId)
        return false;
    return true;
}

function viaLabel(source, id) {
    if (source === 'pub')
        return 'PUB 保存的凭据';
    if (source === 'env')
        return '通过环境变量';
    return `通过 ${LOGIN[id]?.cli ?? '官方 CLI'}`;
}

function applyPrimary(provider, windowId) {
    if (!provider || typeof windowId !== 'string')
        return;
    const target = (provider.windows ?? []).find(window => window.id === windowId);
    if (!target)
        return;
    for (const window of provider.windows)
        window.primary = window.id === windowId;
    provider.remaining = target.remaining;
}

function lastLine(text) {
    const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(line => line.length > 0);
    return lines.at(-1) ?? '';
}

const PubIndicator = GObject.registerClass({
    // Each reload registers the class again; a fixed GType name would collide.
    GTypeName: `PubIndicator_${GLib.uuid_string_random().replaceAll('-', '')}`,
}, class PubIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'PUB', false);
        this.add_style_class_name('pub-panel-button');
        this._ext = extension;
        this._settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        this._snapshot = { fetchedAt: '', remainingMode: true, providers: [] };
        this._selected = 'claude';
        this._page = 'overview';
        this._pendingPage = null;
        this._cli = null;
        this._paste = null;
        this._drag = null;
        this._popoverOpen = false;
        this._refreshing = false;
        this._pendingReason = null;
        this._engineProc = null;
        this._stripIdle = 0;
        this._stripDirty = false;
        this._menuLater = 0;
        this._probeTimer = 0;
        this._probeLastError = '';
        this._probeLastEvent = '';
        this._alive = true;

        this._strip = new St.BoxLayout({
            style_class: 'pub-strip',
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._strip.set_clip_to_allocation(true);
        this.add_child(this._strip);
        this._credentials = {};
        this._schemeId = St.Settings.get().connect('notify::color-scheme', () => {
            this._rebuildStripSoon();
            if (this._popoverOpen)
                this._rebuildMenuSafe();
        });

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeChangedId = this._themeContext.connect('changed', () => {
            this._rebuildStripSoon();
            if (this._popoverOpen)
                this._rebuildMenuSafe();
        });

        this.menu.box.add_style_class_name('pub-popover');
        try {
            this._clickGesture.set_required_button(Clutter.BUTTON_PRIMARY);
        } catch (_error) {
            // Clutter without required-button
        }
        this.menu.actor.connect('captured-event', (_actor, event) => this._onMenuCaptured(event));
        this.connect('button-press-event', (_actor, event) => {
            this._writeProbe({ event: 'button-press', button: event.get_button() });
            return Clutter.EVENT_PROPAGATE;
        });
        this._clickGesture.connect('recognize', () => {
            this._writeProbe({ event: 'click-gesture', menuOpen: !!(this.menu && this.menu.isOpen) });
        });
        this.menu.connect('open-state-changed', (_menu, open) => {
            this._popoverOpen = open;
            this._writeProbe({ event: 'open-state-changed', open });
            if (open) {
                this._context?.close();
                this._choosePageOnOpen(this._pickStripUnderPointer());
                this._readSnapshotFile();
                this._rebuildMenu();
                this._syncChipSelection();
            } else {
                this._endDrag(false);
                this._rebuildStripSoon();
                this._syncChipSelection();
            }
        });

        this._contextManager = new PopupMenu.PopupMenuManager(this);
        this._context = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._context.actor.add_style_class_name('panel-menu');
        this._stageMenu(this._context);
        this._contextManager.addMenu(this._context);
        this._rebuildContext();

        this._loadSettings();
        this._loadCredentials();
        this._readSnapshotFile();
        this._rebuildStrip();
        this._rebuildMenu();
        this._startProbe();
    }

    _rebuildContext() {
        this._context.removeAll();
        this._context.addAction('立即刷新', () => this.requestSnapshot('manual'));
        this._context.addAction('设置…', () => {
            this._pendingPage = 'settings';
            this._openMainMenu();
        });
        this._context.addAction('重新加载', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._ext.reload();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._context.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._context.addAction('退出 PUB', () => {
            Main.extensionManager.disableExtension(this._ext.uuid);
        });
    }

    // ---------- theme helpers ----------

    /*
     * Read the popup's real foreground colour. The system color-scheme alone is not enough:
     * the Ubuntu session maps "default" to a light shell theme, upstream maps it to dark.
     */
    _scheme() {
        try {
            const box = this.menu?.box;
            if (box?.get_stage()) {
                const color = box.get_theme_node().get_foreground_color();
                const scale = color.red <= 1 && color.green <= 1 && color.blue <= 1 ? 1 : 255;
                const luminance = (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / scale;
                return luminance > 0.5 ? 'dark' : 'light';
            }
        } catch (_error) {
            // fall through to settings
        }
        const scheme = St.Settings.get().color_scheme;
        if (scheme === St.SystemColorScheme.PREFER_LIGHT)
            return 'light';
        if (scheme === St.SystemColorScheme.PREFER_DARK)
            return 'dark';
        return Main.sessionMode.colorScheme === 'prefer-light' ? 'light' : 'dark';
    }

    _popFg() {
        return this._scheme() === 'light' ? '#222226' : '#ffffff';
    }

    _icon(id, size, color) {
        const file = this._ext.dir.get_child('icons').get_child(`${id}.svg`);
        const icon = new St.Icon({
            style_class: 'pub-icon',
            icon_size: size,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (!file.query_exists(null))
            return icon;
        try {
            const [, bytes] = file.load_contents(null);
            let svg = new TextDecoder().decode(bytes);
            svg = svg.replaceAll('currentColor', color ?? this._fgColor());
            icon.gicon = Gio.BytesIcon.new(new GLib.Bytes(new TextEncoder().encode(svg)));
        } catch (error) {
            icon.gicon = new Gio.FileIcon({ file });
            console.error('PUB: icon tint failed', error);
        }
        return icon;
    }

    _symbolic(name, size = 16) {
        return new St.Icon({ icon_name: name, icon_size: size, y_align: Clutter.ActorAlign.CENTER });
    }

    _fgColor() {
        try {
            if (!this.get_stage())
                throw new Error('not on stage');
            const color = this.get_theme_node().get_foreground_color();
            let red = color.red;
            let green = color.green;
            let blue = color.blue;
            if (red <= 1 && green <= 1 && blue <= 1) {
                red = Math.round(red * 255);
                green = Math.round(green * 255);
                blue = Math.round(blue * 255);
            } else {
                red = Math.round(red);
                green = Math.round(green);
                blue = Math.round(blue);
            }
            if (red + green + blue > 24)
                return `rgb(${red},${green},${blue})`;
        } catch (_error) {
            // actor not themed yet
        }
        return this._scheme() === 'light' ? '#1a1a1a' : '#f4f4f5';
    }

    _bar(fraction, toneName, height) {
        const track = new St.Widget({
            style_class: 'pub-track',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            height,
        });
        const fill = new St.Widget({
            style_class: 'pub-fill',
            height,
            style: `background-color: ${FILL[toneName] ?? FILL.ok};`,
        });
        track.add_child(fill);
        let disposed = false;
        const sync = () => {
            if (disposed || !this._alive || track.get_parent() === null)
                return;
            const width = track.width;
            if (width > 0)
                fill.set_width(Math.max(0, Math.round(width * Math.min(1, Math.max(0, fraction)))));
        };
        const widthId = track.connect('notify::width', sync);
        track.connect('destroy', () => {
            disposed = true;
            track.disconnect(widthId);
        });
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            sync();
            return GLib.SOURCE_REMOVE;
        });
        return track;
    }

    _label(text, styleClass, extra = {}) {
        const { wrap, ...props } = extra;
        const label = new St.Label({
            text,
            style_class: styleClass,
            y_align: Clutter.ActorAlign.CENTER,
            ...props,
        });
        if (wrap) {
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        }
        return label;
    }

    _spacer() {
        return new St.Widget({ x_expand: true });
    }

    _sep() {
        return new St.Widget({ style_class: 'pub-sep', x_expand: true });
    }

    _pill(text) {
        return this._label(text, 'pub-pill');
    }

    _button(label, styleClass, onClick) {
        const button = new St.Button({
            style_class: `pub-btn ${styleClass ?? ''}`,
            label,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', onClick);
        return button;
    }

    _iconButton(iconName, onClick, accessibleName) {
        const button = new St.Button({
            style_class: 'pub-ibtn',
            child: this._symbolic(iconName, 16),
            can_focus: true,
            accessible_name: accessibleName,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', onClick);
        return button;
    }

    // ---------- Strip ----------

    /*
     * The popover is anchored to the centre of this button. Changing the Strip width while it is
     * open slides the popover out from under the pointer, so defer until it closes.
     */
    _rebuildStripSoon() {
        if (this._popoverOpen) {
            this._stripDirty = true;
            return;
        }
        this._stripDirty = false;
        if (this._stripIdle)
            return;
        this._stripIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._stripIdle = 0;
            if (this._alive)
                this._rebuildStrip();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildStrip() {
        this._strip.destroy_all_children();
        const control = new St.Bin({
            style_class: 'pub-ctrl',
            reactive: true,
            track_hover: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._icon('pub', 16),
        });
        control.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._openContext();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._strip.add_child(control);

        const mode = this._settings.remainingMode;
        for (const provider of this._snapshot.providers.filter(item => item.pinned)) {
            const failed = hasFetchError(provider);
            const stale = failed && hasValue(provider.remaining);
            const chip = new St.BoxLayout({
                style_class: 'pub-chip',
                reactive: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            chip._providerId = provider.id;
            const icon = this._icon(provider.id, 16);
            if (failed || !hasValue(provider.remaining))
                icon.opacity = 140;
            chip.add_child(icon);
            chip.add_child(this._label(
                failed && !stale ? '!' : pctText(provider.remaining, mode),
                `pub-pct${failed && !stale ? ' pub-t-crit' : toneClass(provider.remaining)}`,
            ));
            chip.connect('button-press-event', (_actor, event) => {
                const button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    this._selected = provider.id;
                    return Clutter.EVENT_PROPAGATE;
                }
                if (button === Clutter.BUTTON_SECONDARY) {
                    this._openContext();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._strip.add_child(chip);
        }
        this._syncChipSelection();
    }

    _syncChipSelection() {
        for (const child of this._strip.get_children()) {
            if (child.has_style_class_name('pub-ctrl')) {
                if (this._popoverOpen && this._page !== 'detail')
                    child.add_style_class_name('pub-on');
                else
                    child.remove_style_class_name('pub-on');
                continue;
            }
            if (!child._providerId)
                continue;
            if (this._popoverOpen && this._page === 'detail' && child._providerId === this._selected)
                child.add_style_class_name('pub-on');
            else
                child.remove_style_class_name('pub-on');
        }
    }

    // ---------- menu plumbing (kept from the click-routing fix) ----------

    _stageMenu(menu) {
        if (!menu?.actor)
            return;
        if (menu.actor.get_parent() === null) {
            Main.uiGroup.add_child(menu.actor);
            if (!menu.isOpen)
                menu.actor.hide();
        }
    }

    _openMainMenu() {
        this._context?.close();
        this._stageMenu(this.menu);
        if (this.menu.isOpen) {
            this._choosePageOnOpen(null);
            this._rebuildMenu();
            return;
        }
        try {
            this.menu.open();
        } catch (error) {
            this._probeLastError = String(error);
            console.error('PUB: could not open menu', error);
            this._writeProbe({ event: 'open-failed' });
        }
    }

    _openContext() {
        this.menu.close();
        this._stageMenu(this._context);
        try {
            this._context.open();
        } catch (error) {
            this._probeLastError = String(error);
            console.error('PUB: could not open context menu', error);
            this._writeProbe({ event: 'context-open-failed' });
        }
    }

    _pickStripUnderPointer() {
        try {
            const [x, y] = global.get_pointer();
            const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            if (actor && this.contains(actor))
                return this._selectFromActor(actor);
        } catch (_error) {
            // pointer pick is best-effort
        }
        return null;
    }

    _selectFromActor(actor) {
        while (actor && actor !== this) {
            if (typeof actor.has_style_class_name === 'function' && actor.has_style_class_name('pub-ctrl'))
                return 'control';
            if (actor._providerId) {
                this._selected = actor._providerId;
                return 'chip';
            }
            actor = actor.get_parent();
        }
        return 'strip';
    }

    _choosePageOnOpen(hit) {
        if (this._pendingPage) {
            this._page = this._pendingPage;
            this._pendingPage = null;
        } else if (hit === 'chip') {
            this._page = 'detail';
        } else if (this._shouldResumeLogin()) {
            this._selected = this._cli.id;
            this._page = 'provider';
        } else {
            this._page = 'overview';
        }
    }

    _shouldResumeLogin() {
        return this._cli?.phase === 'waiting';
    }

    _onMenuCaptured(event) {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (!target || !this.contains(target))
            return Clutter.EVENT_PROPAGATE;
        const button = type === Clutter.EventType.BUTTON_PRESS
            ? event.get_button()
            : Clutter.BUTTON_PRIMARY;
        if (button === Clutter.BUTTON_SECONDARY) {
            this._openContext();
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const hit = this._selectFromActor(target);
        if (hit === 'control') {
            this.menu.close();
            return Clutter.EVENT_STOP;
        }
        this._page = 'detail';
        this._rebuildMenu();
        this._syncChipSelection();
        return Clutter.EVENT_STOP;
    }

    _go(page) {
        if (page !== 'provider')
            this._paste = null;
        this._page = page;
        this._rebuildMenu();
        this._syncChipSelection();
    }

    _isEditing() {
        if (!this._popoverOpen || this._page !== 'provider')
            return false;
        if (this._paste)
            return true;
        return this._cli?.phase === 'waiting' && !!LOGIN[this._cli.id]?.codeEntry && !this._cli.submitted;
    }

    /** Rebuild unless the user is typing into a credential field. */
    _rebuildMenuSafe() {
        if (this._isEditing())
            return;
        this._rebuildMenu();
    }

    /** Let a Switch finish its animation before the page is rebuilt. */
    _rebuildMenuLater() {
        if (this._menuLater)
            GLib.Source.remove(this._menuLater);
        this._menuLater = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
            this._menuLater = 0;
            if (this._alive && this._popoverOpen)
                this._rebuildMenuSafe();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildMenu() {
        this._endDrag(false);
        this.menu.removeAll();
        const box = this.menu.box;
        box.remove_style_class_name('pub-light');
        box.remove_style_class_name('pub-dark');
        box.add_style_class_name(this._scheme() === 'light' ? 'pub-light' : 'pub-dark');

        let page;
        if (this._page === 'detail')
            page = this._detailPage();
        else if (this._page === 'settings')
            page = this._settingsPage();
        else if (this._page === 'provider')
            page = this._providerPage();
        else
            page = this._overviewPage();

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            activate: false,
            hover: false,
            style_class: 'pub-menu-item',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);
        item.add_child(page);
        this.menu.addMenuItem(item);
    }

    // ---------- shared pieces ----------

    _stampText() {
        if (this._refreshing)
            return '正在刷新…';
        const at = Date.parse(this._snapshot.fetchedAt);
        if (!Number.isFinite(at))
            return '尚未抓取';
        const minutes = Math.floor((Date.now() - at) / 60000);
        if (minutes < 1)
            return '刚刚刷新';
        if (minutes < 60)
            return `刷新于 ${minutes} 分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return `刷新于 ${hours} 小时前`;
        return `刷新于 ${Math.floor(hours / 24)} 天前`;
    }

    _header({ title, iconId, pill, back, stamp, refresh, gear }) {
        const header = new St.BoxLayout({ style_class: 'pub-hdr', x_expand: true });
        if (back)
            header.add_child(this._iconButton('go-previous-symbolic', back, '返回'));
        else
            header.add_style_class_name('pub-hdr-root');
        if (iconId)
            header.add_child(this._icon(iconId, 16, this._popFg()));
        header.add_child(this._label(title, 'pub-hdr-title'));
        if (pill)
            header.add_child(this._pill(pill));
        header.add_child(this._spacer());
        if (stamp)
            header.add_child(this._label(this._stampText(), 'pub-dim pub-stamp'));
        if (refresh)
            header.add_child(this._iconButton('view-refresh-symbolic', () => this.requestSnapshot('manual'), '立即刷新'));
        if (gear)
            header.add_child(this._iconButton('emblem-system-symbolic', gear, '设置'));
        return header;
    }

    _modeSeg() {
        const seg = new St.BoxLayout({ style_class: 'pub-seg', y_align: Clutter.ActorAlign.CENTER });
        const mode = this._settings.remainingMode;
        for (const [label, value] of [['剩余', true], ['已用', false]]) {
            const button = new St.Button({
                style_class: mode === value ? 'pub-seg-btn pub-seg-on' : 'pub-seg-btn',
                label,
                can_focus: true,
            });
            button.connect('clicked', () => this._setMode(value));
            seg.add_child(button);
        }
        return seg;
    }

    _linkRow(text, onClick) {
        const button = new St.Button({ style_class: 'pub-link-row', can_focus: true, x_expand: true });
        const row = new St.BoxLayout({ x_expand: true });
        row.add_child(this._label(text, 'pub-link-text', { x_expand: true }));
        row.add_child(this._label('↗', 'pub-dim'));
        button.set_child(row);
        button.connect('clicked', onClick);
        return button;
    }

    _group(text) {
        return this._label(text, 'pub-group pub-dim', { x_expand: true });
    }

    _switchRow(title, subtitle, state, sensitive, onToggle) {
        const row = new St.BoxLayout({ style_class: 'pub-srow', x_expand: true });
        const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(this._label(title, 'pub-srow-title'));
        if (subtitle)
            text.add_child(this._label(subtitle, 'pub-dim pub-small'));
        row.add_child(text);
        const toggle = new PopupMenu.Switch(state);
        toggle.reactive = false;
        const button = new St.Button({
            style_class: 'pub-switch-btn',
            child: toggle,
            can_focus: sensitive,
            reactive: sensitive,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: title,
        });
        if (!sensitive)
            button.opacity = 110;
        button.connect('clicked', () => {
            toggle.toggle();
            onToggle(toggle.state);
        });
        row.add_child(button);
        return row;
    }

    _providerName(id) {
        return this._snapshot.providers.find(provider => provider.id === id)?.name ?? PROVIDER_NAMES[id] ?? id;
    }

    // ---------- Overview ----------

    _overviewPage() {
        const page = new St.BoxLayout({ vertical: true, style_class: 'pub-page' });
        page.add_child(this._header({
            title: 'PUB',
            stamp: true,
            refresh: true,
            gear: () => this._go('settings'),
        }));
        page.add_child(this._sep());
        const providers = this._snapshot.providers;
        if (providers.length === 0) {
            const empty = new St.BoxLayout({ vertical: true, style_class: 'pub-empty' });
            empty.add_child(this._label('还没有在监视的 Provider', 'pub-srow-title'));
            empty.add_child(this._label('到设置里打开需要的 Provider 并登录。', 'pub-dim pub-small'));
            page.add_child(empty);
        }
        for (const provider of providers)
            page.add_child(this._overviewRow(provider));
        page.add_child(this._sep());

        const foot = new St.BoxLayout({ style_class: 'pub-foot', x_expand: true });
        foot.add_child(this._label('读法', 'pub-dim pub-small'));
        foot.add_child(this._modeSeg());
        foot.add_child(this._spacer());
        const pinnedCount = providers.filter(provider => provider.pinned).length;
        foot.add_child(this._label(`${pinnedCount} / ${providers.length} 在 Strip 上`, 'pub-dim pub-small'));
        page.add_child(foot);
        return page;
    }

    _overviewRow(provider) {
        const mode = this._settings.remainingMode;
        const window = primaryWindow(provider);
        const failed = errorText(provider);
        const stale = failed !== '' && hasValue(provider.remaining);
        const button = new St.Button({ style_class: 'pub-orow', can_focus: true, x_expand: true });
        const row = new St.BoxLayout({ style_class: 'pub-orow-box', x_expand: true });

        const icon = this._icon(provider.id, 18, this._popFg());
        if (!provider.pinned)
            icon.opacity = 150;
        row.add_child(icon);

        const middle = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'pub-orow-mid' });
        const nameLine = new St.BoxLayout({ style_class: 'pub-inline' });
        nameLine.add_child(this._label(provider.name, provider.pinned ? 'pub-name' : 'pub-name pub-dim'));
        if (window && (!failed || stale))
            nameLine.add_child(this._label(window.label, 'pub-dim pub-small'));
        if (!provider.pinned)
            nameLine.add_child(this._pill('未 Pin'));
        middle.add_child(nameLine);
        if (failed && !stale)
            middle.add_child(this._label(failed, 'pub-small pub-t-crit'));
        else
            middle.add_child(this._bar(shownFraction(provider.remaining, mode), tone(provider.remaining), 5));
        row.add_child(middle);

        const right = new St.BoxLayout({ vertical: true, style_class: 'pub-orow-right', y_align: Clutter.ActorAlign.CENTER });
        if (failed && !stale) {
            const warn = this._symbolic('dialog-warning-symbolic', 16);
            warn.add_style_class_name('pub-t-crit');
            warn.x_align = Clutter.ActorAlign.END;
            right.add_child(warn);
        } else {
            right.add_child(this._label(pctText(provider.remaining, mode),
                `pub-orow-pct${toneClass(provider.remaining)}`, { x_align: Clutter.ActorAlign.END }));
            if (stale)
                right.add_child(this._label('上次数据', 'pub-small pub-t-crit', { x_align: Clutter.ActorAlign.END }));
            else if (window?.resetLabel)
                right.add_child(this._label(window.resetLabel, 'pub-dim pub-small', { x_align: Clutter.ActorAlign.END }));
        }
        row.add_child(right);

        button.set_child(row);
        button.connect('clicked', () => {
            this._selected = provider.id;
            this._go('detail');
        });
        return button;
    }

    // ---------- Detail ----------

    _detailPage() {
        const provider = this._snapshot.providers.find(item => item.id === this._selected)
            ?? this._snapshot.providers[0]
            ?? null;
        const page = new St.BoxLayout({ vertical: true, style_class: 'pub-page' });
        if (provider === null) {
            this._page = 'overview';
            return this._overviewPage();
        }
        this._selected = provider.id;
        const mode = this._settings.remainingMode;
        const word = mode ? 'left' : 'used';
        page.add_child(this._header({
            title: provider.name,
            iconId: provider.id,
            pill: provider.plan,
            back: () => this._go('overview'),
            stamp: true,
            refresh: true,
        }));

        const body = new St.BoxLayout({ vertical: true, style_class: 'pub-detail' });
        const failed = errorText(provider);
        const window = primaryWindow(provider);
        if (failed) {
            const row = new St.BoxLayout({ style_class: 'pub-inline pub-error-row', x_expand: true });
            const warn = this._symbolic('dialog-warning-symbolic', 16);
            warn.add_style_class_name('pub-t-crit');
            row.add_child(warn);
            row.add_child(this._label(failed, 'pub-t-crit', { x_expand: true, wrap: true }));
            if (isSignedOut(provider)) {
                row.add_child(this._button('去登录', 'pub-btn-sug', () => this._go('provider')));
            } else if (hasValue(provider.remaining)) {
                row.add_child(this._label('下面是上次数据', 'pub-dim pub-small'));
            }
            body.add_child(row);
        }
        if (window && hasValue(window.remaining)) {
            const big = new St.BoxLayout({ style_class: 'pub-big-row', x_expand: true });
            big.add_child(this._label(pctText(window.remaining, mode), `pub-big${toneClass(window.remaining)}`));
            big.add_child(this._label(`${word} · ${window.label}`, 'pub-dim', { y_align: Clutter.ActorAlign.END }));
            big.add_child(this._spacer());
            if (window.resetLabel)
                big.add_child(this._label(window.resetLabel, 'pub-dim pub-small', { y_align: Clutter.ActorAlign.END }));
            body.add_child(big);
            body.add_child(this._bar(shownFraction(window.remaining, mode), tone(window.remaining), 8));
        }

        for (const other of (provider.windows ?? []).filter(item => item !== window)) {
            const block = new St.BoxLayout({ vertical: true, style_class: 'pub-win', x_expand: true });
            const line = new St.BoxLayout({ x_expand: true });
            line.add_child(this._label(other.label, 'pub-win-title', { x_expand: true }));
            line.add_child(this._label(hasValue(other.remaining) ? `${pctText(other.remaining, mode)} ${word}` : '—',
                `pub-win-value${toneClass(other.remaining)}`));
            block.add_child(line);
            block.add_child(this._bar(shownFraction(other.remaining, mode), tone(other.remaining), 5));
            block.add_child(this._label(other.resetLabel || '—', 'pub-dim pub-small'));
            body.add_child(block);
        }

        const facts = [];
        if (provider.extra)
            facts.push(['Extra usage', `${provider.extra.label ?? 'This month'} · ${Math.round(provider.extra.usedFraction * 100)}% used`]);
        else if (provider.extraNote)
            facts.push(['Extra usage', provider.extraNote]);
        if (provider.cost?.today)
            facts.push(['今日花费', provider.cost.today]);
        if (provider.cost?.month)
            facts.push(['Cost', provider.cost.month]);
        for (const [label, value] of facts) {
            const line = new St.BoxLayout({ style_class: 'pub-win', x_expand: true });
            line.add_child(this._label(label, 'pub-win-title', { x_expand: true }));
            line.add_child(this._label(value, 'pub-dim'));
            body.add_child(line);
        }
        page.add_child(body);

        page.add_child(this._sep());
        page.add_child(this._linkRow(`打开 ${provider.name} 用量页`, () => this._openUri(provider.usageUrl, true)));
        page.add_child(this._linkRow('打开状态页', () => this._openUri(provider.statusUrl, true)));
        return page;
    }

    // ---------- Settings ----------

    _settingsPage() {
        const page = new St.BoxLayout({ vertical: true, style_class: 'pub-page' });
        page.add_child(this._header({ title: '设置', back: () => this._go('overview') }));

        const modeRow = new St.BoxLayout({ style_class: 'pub-srow', x_expand: true });
        const modeText = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        modeText.add_child(this._label('百分比读法', 'pub-srow-title'));
        modeText.add_child(this._label('Strip 与 Overview 同时生效', 'pub-dim pub-small'));
        modeRow.add_child(modeText);
        modeRow.add_child(this._modeSeg());
        page.add_child(modeRow);
        page.add_child(this._sep());

        page.add_child(this._group('PROVIDER · 拖动右侧把手调整顺序'));
        const list = new St.BoxLayout({ vertical: true, x_expand: true });
        const rows = [];
        this._settings.providers.forEach((setting, index) => {
            const row = this._settingsRow(setting, index, rows);
            rows.push(row);
            list.add_child(row);
        });
        page.add_child(list);
        const pinnedCount = this._settings.providers.filter(item => item.enabled && item.pinned).length;
        page.add_child(this._label(`${pinnedCount} 个在 Strip 上 · 点一行进入该 Provider 的登录与显示设置`,
            'pub-dim pub-small pub-hint', { x_expand: true, wrap: true }));
        return page;
    }

    _settingsRow(setting, index, rows) {
        const live = this._snapshot.providers.find(provider => provider.id === setting.id);
        const row = new St.BoxLayout({
            style_class: 'pub-prow',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        const main = new St.Button({ style_class: 'pub-prow-main', can_focus: true, x_expand: true });
        const mainBox = new St.BoxLayout({ style_class: 'pub-inline-wide', x_expand: true });
        const icon = this._icon(setting.id, 18, this._popFg());
        if (!setting.enabled)
            icon.opacity = 110;
        mainBox.add_child(icon);
        const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(this._label(this._providerName(setting.id), setting.enabled ? 'pub-name' : 'pub-name pub-dim'));
        const status = this._loginStatus(setting, live);
        text.add_child(this._label(status.text, `pub-small ${status.bad ? 'pub-t-crit' : 'pub-dim'}`));
        mainBox.add_child(text);
        main.set_child(mainBox);
        main.connect('clicked', () => {
            this._selected = setting.id;
            this._go('provider');
        });
        row.add_child(main);

        const pin = new St.Button({
            style_class: setting.pinned && setting.enabled ? 'pub-ibtn pub-pin pub-pin-on' : 'pub-ibtn pub-pin',
            child: this._symbolic('view-pin-symbolic', 16),
            can_focus: setting.enabled,
            reactive: setting.enabled,
            accessible_name: setting.pinned ? '从 Strip 移除' : '固定到 Strip',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (!setting.enabled)
            pin.opacity = 90;
        pin.connect('clicked', () => this._setPinned(setting.id, !setting.pinned, true));
        row.add_child(pin);

        const grip = new St.Bin({
            style_class: 'pub-ibtn pub-grip',
            child: this._symbolic('list-drag-handle-symbolic', 16),
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        grip.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._beginDrag(rows, index);
            return Clutter.EVENT_STOP;
        });
        grip.connect('touch-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            this._beginDrag(rows, index);
            return Clutter.EVENT_STOP;
        });
        row.add_child(grip);
        return row;
    }

    _credentialSource(id, live) {
        if (credentialComplete(id, this._credentials[id]))
            return 'pub';
        if (live?.credentialSource)
            return live.credentialSource;
        return null;
    }

    _loginStatus(setting, live) {
        if (this._cli?.id === setting.id && this._cli.phase === 'waiting')
            return { text: '正在浏览器中登录…', bad: false };
        if (!setting.enabled)
            return { text: '未监视 · 不抓取', bad: false };
        const source = this._credentialSource(setting.id, live);
        if (source === null)
            return { text: '未登录', bad: true };
        const via = viaLabel(source, setting.id);
        const plan = live?.plan ? ` · ${live.plan}` : '';
        if (live && hasFetchError(live) && !isSignedOut(live))
            return { text: `已登录 · ${via} · 抓取失败 ${live.error}`, bad: true };
        return { text: `已登录 · ${via}${plan}`, bad: false };
    }

    // ---------- drag to reorder ----------

    _beginDrag(rows, from) {
        this._endDrag(false);
        const menuActor = this.menu.actor;
        const drag = { rows, from, to: from, handler: 0, actor: menuActor };
        rows[from].add_style_class_name('pub-dragging');
        drag.handler = menuActor.connect('captured-event', (_actor, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) {
                const [, y] = event.get_coords();
                const to = this._dropIndex(rows, from, y);
                if (to !== drag.to) {
                    drag.to = to;
                    rows[from].get_parent()?.set_child_at_index(rows[from], to);
                }
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE
                || type === Clutter.EventType.TOUCH_END
                || type === Clutter.EventType.TOUCH_CANCEL) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._alive && this._drag === drag)
                        this._endDrag(true);
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._drag = drag;
    }

    _dropIndex(rows, from, y) {
        let to = 0;
        rows.forEach((row, index) => {
            if (index === from)
                return;
            const [, rowY] = row.get_transformed_position();
            if (y > rowY + row.height / 2)
                to++;
        });
        return to;
    }

    _endDrag(commit) {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = null;
        try {
            drag.actor.disconnect(drag.handler);
        } catch (_error) {
            // menu already gone
        }
        if (commit && drag.to !== drag.from) {
            const list = this._settings.providers;
            const [row] = list.splice(drag.from, 1);
            list.splice(drag.to, 0, row);
            this._writeSettings();
            this._applyProviderOrder();
            this._rebuildStripSoon();
            this._rebuildMenu();
            return;
        }
        for (const row of drag.rows) {
            try {
                row.remove_style_class_name('pub-dragging');
            } catch (_error) {
                // row destroyed by a rebuild
            }
        }
    }

    // ---------- Provider page ----------

    _providerPage() {
        const id = this._selected;
        const setting = this._settings.providers.find(item => item.id === id);
        if (!setting) {
            this._page = 'settings';
            return this._settingsPage();
        }
        const live = this._snapshot.providers.find(provider => provider.id === id);
        const name = this._providerName(id);
        const page = new St.BoxLayout({ vertical: true, style_class: 'pub-page' });
        page.add_child(this._header({ title: name, back: () => this._go('settings') }));
        page.add_child(this._loginCard(id, live));

        page.add_child(this._group('显示'));
        page.add_child(this._switchRow('监视此 Provider', '关闭后不再抓取，也不出现在 Overview',
            setting.enabled, true, state => this._setEnabled(id, state)));
        page.add_child(this._switchRow('固定到 Strip', null,
            setting.enabled && setting.pinned, setting.enabled, state => this._setPinned(id, state, false)));

        page.add_child(this._group('PRIMARY WINDOW · Strip 与 Overview 显示这一项'));
        const windows = live?.windows ?? [];
        if (windows.length === 0) {
            page.add_child(this._label('登录并抓取成功后可以选择。', 'pub-dim pub-small pub-hint', { x_expand: true, wrap: true }));
        } else {
            const mode = this._settings.remainingMode;
            const chosen = typeof setting.primary === 'string' && windows.some(window => window.id === setting.primary)
                ? setting.primary
                : null;
            page.add_child(this._radioRow('自动', '服务商默认的那一项', null, chosen === null, () => this._setPrimary(id, null)));
            for (const window of windows) {
                page.add_child(this._radioRow(window.label, window.resetLabel,
                    hasValue(window.remaining) ? pctText(window.remaining, mode) : null,
                    chosen === window.id, () => this._setPrimary(id, window.id), window.remaining));
            }
        }

        page.add_child(this._sep());
        page.add_child(this._linkRow(`打开 ${name} 用量页`,
            () => this._openUri(live?.usageUrl ?? USAGE_URLS[id], true)));
        return page;
    }

    _radioRow(title, subtitle, value, on, onPick, remaining) {
        const button = new St.Button({ style_class: 'pub-radio-row', can_focus: true, x_expand: true });
        const row = new St.BoxLayout({ style_class: 'pub-inline-wide', x_expand: true });
        const dot = new St.Bin({
            style_class: on ? 'pub-radio pub-radio-on' : 'pub-radio',
            y_align: Clutter.ActorAlign.CENTER,
            child: on ? new St.Widget({ style_class: 'pub-radio-dot' }) : null,
        });
        row.add_child(dot);
        const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(this._label(title, 'pub-srow-title'));
        if (subtitle)
            text.add_child(this._label(subtitle, 'pub-dim pub-small'));
        row.add_child(text);
        if (value)
            row.add_child(this._label(value, `pub-win-value${toneClass(remaining)}`));
        button.set_child(row);
        button.connect('clicked', onPick);
        return button;
    }

    _loginCard(id, live) {
        const spec = LOGIN[id];
        const card = new St.BoxLayout({ vertical: true, style_class: 'pub-card', x_expand: true });
        if (!spec) {
            card.add_child(this._label('这个 Provider 暂不支持在 PUB 里登录。', 'pub-dim'));
            return card;
        }
        const title = (text, pill) => {
            const line = new St.BoxLayout({ style_class: 'pub-inline' });
            line.add_child(this._icon(id, 16, this._popFg()));
            line.add_child(this._label(text, 'pub-card-title'));
            if (pill)
                line.add_child(this._pill(pill));
            return line;
        };
        const describe = text => this._label(text, 'pub-dim pub-card-desc', { x_expand: true, wrap: true });
        const acts = () => new St.BoxLayout({ style_class: 'pub-acts', x_expand: true });
        const cli = this._cli?.id === id ? this._cli : null;
        const paste = this._paste?.id === id ? this._paste : null;

        if (cli?.phase === 'waiting') {
            card.add_child(title('正在浏览器中登录'));
            if (spec.codeEntry) {
                card.add_child(describe(`在浏览器里完成授权。如果页面显示 Authentication code，点「Copy code」后粘贴到下面。`));
                if (cli.submitted) {
                    card.add_child(this._label('正在验证授权码…', 'pub-dim pub-small'));
                } else {
                    const code = new St.Entry({ hint_text: spec.codeEntry.hint, can_focus: true, x_expand: true });
                    code.add_style_class_name('pub-entry');
                    const submit = () => this._submitLoginCode(cli, code.get_text());
                    code.clutter_text.connect('activate', submit);
                    card.add_child(code);
                    if (cli.message)
                        card.add_child(this._label(cli.message, 'pub-small pub-t-crit', { wrap: true }));
                    const codeRow = acts();
                    codeRow.add_child(this._button('提交授权码', 'pub-btn-sug', submit));
                    card.add_child(codeRow);
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (this._alive && code.get_stage())
                            code.grab_key_focus();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else {
                card.add_child(describe(`已启动 ${spec.cli}。在浏览器里完成授权后，它会写入 ${spec.file}，PUB 随即刷新。`));
            }
            const row = acts();
            row.add_child(this._label('等待授权…', 'pub-dim pub-small'));
            row.add_child(this._spacer());
            if (cli.url)
                row.add_child(this._button('打开授权页 ↗', 'pub-btn-quiet', () => this._openUri(cli.url, false)));
            row.add_child(this._button('取消', 'pub-btn-quiet', () => {
                this._cancelLogin();
                this._rebuildMenu();
            }));
            card.add_child(row);
            return card;
        }

        if (paste) {
            card.add_child(title('粘贴凭据'));
            if (spec.kind === 'key')
                card.add_child(describe(`在 ${spec.pageLabel} 创建一个 API key，粘贴到下面。`));
            else if (spec.kind === 'cli' && id === 'cursor')
                card.add_child(describe('粘贴 WorkosCursorSessionToken，或 cursor-agent 登录后写入的 JWT。带 userId:: 或 JWT 即可，不必再填 user ID。'));
            else
                card.add_child(describe(`手动方式，一般用不到：${spec.cli} 登录后 PUB 会自动读取。`));
            const token = new St.Entry({ hint_text: spec.hint, can_focus: true, x_expand: true });
            token.add_style_class_name('pub-entry');
            token.clutter_text.set_password_char('●');
            card.add_child(token);
            let extra = null;
            if (spec.extra) {
                extra = new St.Entry({ hint_text: spec.extra.hint, can_focus: true, x_expand: true });
                extra.add_style_class_name('pub-entry');
                card.add_child(extra);
            }
            if (paste.message)
                card.add_child(this._label(paste.message, 'pub-small pub-t-crit', { wrap: true }));
            const row = acts();
            row.add_child(this._button('保存', 'pub-btn-sug', () => this._savePaste(id, token.get_text(), extra?.get_text() ?? '')));
            row.add_child(this._button('取消', 'pub-btn-quiet', () => {
                this._paste = null;
                this._rebuildMenu();
            }));
            row.add_child(this._spacer());
            if (spec.page)
                row.add_child(this._button(`打开 ${spec.pageLabel} ↗`, 'pub-btn-quiet', () => this._openUri(spec.page, false)));
            card.add_child(row);
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._alive && token.get_stage())
                    token.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
            return card;
        }

        const source = this._credentialSource(id, live);
        const cliPath = spec.bin ? this._findCli(spec.bin) : null;
        const row = acts();
        if (source !== null) {
            card.add_child(title('已登录', live?.plan));
            card.add_child(describe(source === 'pub'
                ? '凭据由 PUB 保存在 ~/.config/pub/credentials.json，只有你可读。'
                : source === 'env'
                    ? '凭据来自环境变量，PUB 不能在这里移除。'
                    : `凭据来自 ${spec.cli}（${spec.file}）。用量过期后请在官方 CLI 里续期，PUB 不代为刷新。`));
            if (live && hasFetchError(live) && !isSignedOut(live))
                card.add_child(this._label(`上次抓取失败：${live.error}`, 'pub-small pub-t-crit', { wrap: true }));
            if (source === 'pub') {
                row.add_child(this._button('移除凭据', '', () => this._clearCredential(id)));
            } else if (source === 'cli' && cliPath) {
                row.add_child(this._button('重新登录 ↗', '', () => this._startCliLogin(id)));
            }
            row.add_child(this._button(source === 'pub' ? '换一个凭据…' : '改用粘贴…', 'pub-btn-quiet', () => this._beginPaste(id)));
        } else {
            card.add_child(title('未登录'));
            if (spec.kind === 'cli') {
                card.add_child(describe(cliPath
                    ? `${spec.cli} 会打开浏览器完成授权。PUB 只读取它写下的凭据，不需要复制 token。`
                    : `本机没有找到 ${spec.bin} 命令。安装 ${spec.cli} 后可以在浏览器里登录，也可以手动粘贴。`));
                if (cliPath)
                    row.add_child(this._button('在浏览器中登录 ↗', 'pub-btn-sug', () => this._startCliLogin(id)));
            } else {
                card.add_child(describe(`${this._providerName(id)} 用 API key。在网页里创建后粘贴即可。`));
                row.add_child(this._button(`打开 ${spec.pageLabel} ↗`, 'pub-btn-sug', () => {
                    this._openUri(spec.page, false);
                    this._beginPaste(id);
                }));
            }
            row.add_child(this._button('手动粘贴…', 'pub-btn-quiet', () => this._beginPaste(id)));
            if (spec.kind === 'key' && cliPath)
                row.add_child(this._button('用 CLI 登录 ↗', 'pub-btn-quiet', () => this._startCliLogin(id)));
            if (this._credentials[id]?.token)
                row.add_child(this._button('移除凭据', '', () => this._clearCredential(id)));
        }
        if (cli?.phase === 'error')
            card.add_child(this._label(cli.message, 'pub-small pub-t-crit', { wrap: true }));
        card.add_child(row);
        return card;
    }

    // ---------- login actions ----------

    _findCli(bin) {
        const home = GLib.get_home_dir();
        const fake = GLib.getenv('PUB_PROBE') === '1' ? GLib.getenv('PUB_FAKE_CLI_DIR') : null;
        const dirs = [
            ...fake ? [fake] : [],
            GLib.build_filenamev([home, '.local', 'bin']),
            GLib.build_filenamev([home, '.npm-global', 'bin']),
            GLib.build_filenamev([home, '.bun', 'bin']),
            '/usr/local/bin',
            '/usr/bin',
        ];
        for (const dir of dirs) {
            const path = GLib.build_filenamev([dir, bin]);
            if (GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE))
                return path;
        }
        return GLib.find_program_in_path(bin);
    }

    _beginPaste(id) {
        if (this._cli?.proc)
            this._cancelLogin();
        this._paste = { id, message: '' };
        this._rebuildMenu();
    }

    _startCliLogin(id) {
        const spec = LOGIN[id];
        const path = spec ? this._findCli(spec.bin) : null;
        this._cancelLogin();
        this._paste = null;
        if (!spec || !path) {
            this._cli = { id, phase: 'error', message: `没有找到 ${spec?.bin ?? id} 命令。` };
            this._rebuildMenu();
            return;
        }
        const login = { id, phase: 'waiting', proc: null, url: '', output: '', cancelled: false, timeout: 0, cancellable: new Gio.Cancellable() };
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE
                    | Gio.SubprocessFlags.STDOUT_PIPE
                    | Gio.SubprocessFlags.STDERR_MERGE,
            });
            const inherited = GLib.getenv('PATH') ?? '/usr/local/bin:/usr/bin:/bin';
            launcher.setenv('PATH', `${GLib.path_get_dirname(path)}:${inherited}`, true);
            launcher.setenv('NO_COLOR', '1', true);
            login.proc = launcher.spawnv([path, ...spec.args]);
        } catch (error) {
            this._cli = { id, phase: 'error', message: `无法启动 ${spec.cli}：${error.message ?? error}` };
            this._rebuildMenu();
            return;
        }
        this._cli = login;

        const stream = new Gio.DataInputStream({ base_stream: login.proc.get_stdout_pipe(), close_base_stream: true });
        const readLine = () => {
            stream.read_line_async(GLib.PRIORITY_DEFAULT, login.cancellable, (source, result) => {
                let line = null;
                try {
                    [line] = source.read_line_finish_utf8(result);
                } catch (_error) {
                    return;
                }
                if (line === null)
                    return;
                login.output = `${login.output}\n${line}`.slice(-4000);
                const visible = this._alive && this._popoverOpen && this._page === 'provider' && this._cli === login;
                const url = line.match(/https:\/\/[^\s"'<>]+/u);
                if (url && !login.url) {
                    login.url = url[0];
                    if (visible && !this._isEditing())
                        this._rebuildMenu();
                }
                if (spec.codeEntry?.invalid.test(line) && this._cli === login) {
                    login.submitted = false;
                    login.message = '授权码无效或已过期。请在浏览器里重新点「Copy code」，粘贴完整内容。';
                    if (visible)
                        this._rebuildMenu();
                }
                readLine();
            });
        };
        readLine();

        login.proc.wait_async(login.cancellable, (proc, result) => {
            try {
                proc.wait_finish(result);
            } catch (_error) {
                // cancelled or killed
            }
            if (!this._alive || this._cli !== login)
                return;
            if (login.timeout) {
                GLib.Source.remove(login.timeout);
                login.timeout = 0;
            }
            const ok = proc.get_if_exited() && proc.get_exit_status() === 0;
            if (ok) {
                this._cli = null;
                this._loadCredentials();
                this.requestSnapshot('login');
            } else {
                const detail = lastLine(login.output);
                this._cli = {
                    id,
                    phase: 'error',
                    message: detail ? `${spec.cli} 登录没有完成：${detail}` : `${spec.cli} 登录没有完成。`,
                };
            }
            if (this._popoverOpen)
                this._rebuildMenuSafe();
            else
                this._rebuildStripSoon();
        });

        login.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LOGIN_WAIT_SECONDS, () => {
            login.timeout = 0;
            if (this._alive && this._cli === login) {
                this._cancelLogin();
                this._cli = { id, phase: 'error', message: '等待授权超时，已停止。可以再试一次。' };
                if (this._popoverOpen)
                    this._rebuildMenuSafe();
            }
            return GLib.SOURCE_REMOVE;
        });
        this._rebuildMenu();
    }

    _submitLoginCode(login, text) {
        if (this._cli !== login || !login.proc)
            return;
        const code = text.trim();
        if (!code.includes('#')) {
            login.message = '授权码不完整。请用页面上的「Copy code」复制，内容里应包含一个 #。';
            this._rebuildMenu();
            return;
        }
        try {
            const stdin = login.proc.get_stdin_pipe();
            stdin.write_all(new TextEncoder().encode(`${code}\n`), null);
            stdin.flush(null);
            try {
                stdin.close(null);
            } catch (_error) {
                // already closed
            }
            login.submitted = true;
            login.message = '';
        } catch (error) {
            login.message = `无法把授权码交给 ${LOGIN[login.id]?.cli ?? 'CLI'}：${error.message ?? error}`;
        }
        this._rebuildMenu();
    }

    _cancelLogin() {
        const login = this._cli;
        this._cli = null;
        if (!login?.proc)
            return;
        login.cancelled = true;
        login.cancellable?.cancel();
        if (login.timeout) {
            GLib.Source.remove(login.timeout);
            login.timeout = 0;
        }
        try {
            login.proc.force_exit();
        } catch (_error) {
            // already exited
        }
    }

    _savePaste(id, tokenText, extraText) {
        const spec = LOGIN[id];
        const token = tokenText.trim();
        const extra = extraText.trim();
        if (token.length === 0) {
            this._paste = { id, message: '先粘贴凭据。' };
            this._rebuildMenu();
            return;
        }
        if (spec?.extra?.required && extra.length === 0) {
            this._paste = { id, message: `还需要填写 ${spec.extra.hint}。` };
            this._rebuildMenu();
            return;
        }
        const raw = { token };
        if (spec?.extra && extra.length > 0)
            raw[spec.extra.key] = extra;
        const credential = canonicalizeCredential(raw, id);
        if (!credential) {
            this._paste = { id, message: '先粘贴凭据。' };
            this._rebuildMenu();
            return;
        }
        this._credentials[id] = credential;
        this._writeCredentials();
        this._paste = null;
        this.requestSnapshot('manual');
        this._rebuildMenu();
    }

    _clearCredential(id) {
        delete this._credentials[id];
        this._writeCredentials();
        this.requestSnapshot('manual');
        this._rebuildMenu();
    }

    // ---------- settings actions ----------

    _setMode(remainingMode) {
        this._settings.remainingMode = remainingMode;
        this._snapshot.remainingMode = remainingMode;
        this._writeSettings();
        this._rebuildStripSoon();
        this._rebuildMenu();
    }

    _setEnabled(id, enabled) {
        const setting = this._settings.providers.find(item => item.id === id);
        if (!setting)
            return;
        setting.enabled = enabled;
        if (!enabled) {
            setting.pinned = false;
            if (this._cli?.id === id)
                this._cancelLogin();
        }
        this._writeSettings();
        this._readSnapshotFile();
        this._rebuildStripSoon();
        this._rebuildMenuLater();
    }

    _setPinned(id, pinned, immediate) {
        const setting = this._settings.providers.find(item => item.id === id);
        if (!setting || !setting.enabled)
            return;
        setting.pinned = pinned;
        const live = this._snapshot.providers.find(provider => provider.id === id);
        if (live)
            live.pinned = pinned;
        this._writeSettings();
        this._rebuildStripSoon();
        if (immediate)
            this._rebuildMenu();
        else
            this._rebuildMenuLater();
    }

    _setPrimary(id, windowId) {
        const setting = this._settings.providers.find(item => item.id === id);
        if (!setting)
            return;
        if (windowId === null)
            delete setting.primary;
        else
            setting.primary = windowId;
        this._writeSettings();
        this._readSnapshotFile();
        this._rebuildStripSoon();
        this._rebuildMenu();
    }

    _applyProviderOrder() {
        const order = this._settings.providers.map(row => row.id);
        this._snapshot.providers.sort((left, right) => {
            const a = order.indexOf(left.id);
            const b = order.indexOf(right.id);
            return (a === -1 ? order.length : a) - (b === -1 ? order.length : b);
        });
    }

    _openUri(uri, closeMenu) {
        if (typeof uri !== 'string' || uri.length === 0)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (error) {
            console.error('PUB: could not open uri', error);
        }
        if (closeMenu)
            this.menu.close();
    }

    // ---------- files ----------

    _settingsPath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'pub', 'settings.json']);
    }

    _credentialsPath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'pub', 'credentials.json']);
    }

    _snapshotPath() {
        return GLib.build_filenamev([GLib.get_user_cache_dir(), 'pub', 'snapshot.json']);
    }

    _loadSettings() {
        const file = Gio.File.new_for_path(this._settingsPath());
        if (!file.query_exists(null))
            return;
        try {
            const [, bytes] = file.load_contents(null);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (!parsed || !Array.isArray(parsed.providers) || parsed.providers.length === 0)
                return;
            this._settings = {
                remainingMode: parsed.remainingMode !== false,
                providers: this._mergeProviders(parsed.providers),
            };
            this._snapshot.remainingMode = this._settings.remainingMode;
        } catch (error) {
            console.error('PUB: could not read settings', error);
        }
    }

    _mergeProviders(rows) {
        const merged = [];
        const seen = new Set();
        for (const item of rows) {
            if (!item || typeof item.id !== 'string' || item.id.length === 0)
                continue;
            if (seen.has(item.id))
                continue;
            seen.add(item.id);
            const row = {
                id: item.id,
                enabled: item.enabled !== false,
                pinned: item.pinned === true,
            };
            if (typeof item.primary === 'string' && item.primary.length > 0)
                row.primary = item.primary;
            merged.push(row);
        }
        for (const row of DEFAULT_SETTINGS.providers) {
            if (seen.has(row.id))
                continue;
            merged.push(JSON.parse(JSON.stringify(row)));
        }
        return merged.length > 0 ? merged : JSON.parse(JSON.stringify(DEFAULT_SETTINGS.providers));
    }

    _loadCredentials() {
        this._credentials = {};
        const file = Gio.File.new_for_path(this._credentialsPath());
        if (!file.query_exists(null))
            return;
        try {
            const [, bytes] = file.load_contents(null);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (!parsed || typeof parsed !== 'object')
                return;
            for (const [id, item] of Object.entries(parsed)) {
                const credential = canonicalizeCredential(item, id);
                if (credential)
                    this._credentials[id] = credential;
            }
        } catch (error) {
            console.error('PUB: could not read credentials', error);
        }
    }

    _writeCredentials() {
        const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'pub']));
        try {
            dir.make_directory_with_parents(null);
        } catch (_error) {
            // already exists
        }
        const file = Gio.File.new_for_path(this._credentialsPath());
        const body = JSON.stringify(this._credentials, null, 2);
        file.replace_contents(
            body,
            null,
            false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
        try {
            file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
        } catch (_error) {
            // mode best-effort
        }
    }

    _writeSettings() {
        const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'pub']));
        try {
            dir.make_directory_with_parents(null);
        } catch (_error) {
            // already exists
        }
        const file = Gio.File.new_for_path(this._settingsPath());
        file.replace_contents(
            JSON.stringify(this._settings, null, 2),
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null,
        );
    }

    _readSnapshotFile() {
        const file = Gio.File.new_for_path(this._snapshotPath());
        if (!file.query_exists(null))
            return;
        try {
            const [, bytes] = file.load_contents(null);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (parsed && Array.isArray(parsed.providers)) {
                const enabled = new Set(this._settings.providers.filter(row => row.enabled).map(row => row.id));
                this._snapshot = parsed;
                this._snapshot.remainingMode = this._settings.remainingMode;
                this._snapshot.providers = this._snapshot.providers.filter(provider => enabled.has(provider.id));
                for (const provider of this._snapshot.providers) {
                    const row = this._settings.providers.find(item => item.id === provider.id);
                    if (!row)
                        continue;
                    provider.pinned = row.pinned === true;
                    applyPrimary(provider, row.primary);
                }
                this._applyProviderOrder();
            }
        } catch (error) {
            console.error('PUB: could not read snapshot', error);
        }
        if (this._snapshot.providers.every(provider => provider.id !== this._selected)
            && this._page === 'detail')
            this._selected = this._snapshot.providers[0]?.id ?? 'claude';
    }

    _refreshUi() {
        if (this._popoverOpen) {
            this._rebuildMenuSafe();
            this._syncChipSelection();
        } else {
            this._rebuildStripSoon();
        }
    }

    requestSnapshot(reason) {
        this._readSnapshotFile();
        if (this._refreshing) {
            this._pendingReason = reason;
            this._refreshUi();
            return;
        }
        const engine = this._ext.dir.get_child('bin').get_child('pub-engine.mjs');
        const node = GLib.file_test('/usr/bin/node', GLib.FileTest.IS_EXECUTABLE)
            ? '/usr/bin/node'
            : GLib.find_program_in_path('node');
        if (!engine.query_exists(null) || !node) {
            this._refreshUi();
            return;
        }
        this._refreshing = true;
        try {
            const proc = Gio.Subprocess.new(
                [node, engine.get_path(), 'snapshot', '--out', this._snapshotPath()],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
            this._engineProc = proc;
            proc.communicate_utf8_async(null, null, (subprocess, result) => {
                this._refreshing = false;
                this._engineProc = null;
                try {
                    subprocess.communicate_utf8_finish(result);
                } catch (error) {
                    if (this._alive)
                        console.error('PUB: engine failed', error);
                }
                if (!this._alive)
                    return;
                this._readSnapshotFile();
                this._refreshUi();
                if (this._pendingReason) {
                    const next = this._pendingReason;
                    this._pendingReason = null;
                    this.requestSnapshot(next);
                }
            });
        } catch (error) {
            this._refreshing = false;
            this._engineProc = null;
            console.error('PUB: could not spawn engine', error);
        }
        this._refreshUi();
    }

    _killEngine() {
        if (this._engineProc) {
            try {
                this._engineProc.force_exit();
            } catch (_error) {
                // already exited
            }
            this._engineProc = null;
        }
        this._refreshing = false;
        this._pendingReason = null;
    }

    // ---------- probe (PUB_PROBE=1 only, used by scripts/nested-shell.sh) ----------

    _probePath() {
        const dir = GLib.getenv('XDG_STATE_HOME');
        if (!dir)
            return null;
        return GLib.build_filenamev([dir, 'pub-probe.json']);
    }

    _writeProbe(extra) {
        if (GLib.getenv('PUB_PROBE') !== '1')
            return;
        const path = this._probePath();
        if (!path)
            return;
        try {
            const menuParent = this.menu?.actor ? this.menu.actor.get_parent() !== null : false;
            const contextParent = this._context?.actor ? this._context.actor.get_parent() !== null : false;
            let empty = null;
            try {
                empty = this.menu ? this.menu.isEmpty() : null;
            } catch (_error) {
                empty = 'error';
            }
            const [sx, sy] = this.get_transformed_position();
            const payload = {
                ts: GLib.get_monotonic_time(),
                isOpen: !!(this.menu && this.menu.isOpen),
                contextOpen: !!(this._context && this._context.isOpen),
                menuParent,
                contextParent,
                empty,
                mapped: this.mapped,
                width: this.width,
                height: this.height,
                x: this.x,
                y: this.y,
                stageX: sx,
                stageY: sy,
                stageW: global.stage.width,
                stageH: global.stage.height,
                popoverOpen: this._popoverOpen,
                page: this._page,
                selected: this._selected,
                login: this._cli
                    ? { id: this._cli.id, phase: this._cli.phase }
                    : this._paste
                        ? { id: this._paste.id, phase: 'paste' }
                        : null,
                ui: import.meta.url,
                lastError: this._probeLastError || '',
                lastEvent: extra && extra.event && extra.event !== 'poll'
                    ? extra.event
                    : (this._probeLastEvent || ''),
            };
            if (extra && extra.event && extra.event !== 'poll')
                this._probeLastEvent = extra.event;
            const data = Object.assign(payload, extra || {});
            const bytes = new TextEncoder().encode(`${JSON.stringify(data)}\n`);
            Gio.File.new_for_path(path).replace_contents(bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (error) {
            console.error('[DEBUG-pub1] probe write failed', error);
        }
    }

    _startProbe() {
        if (GLib.getenv('PUB_PROBE') !== '1')
            return;
        this._probeLastError = '';
        this._writeProbe({ event: 'enable' });
        this._probeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            if (!this._alive)
                return GLib.SOURCE_REMOVE;
            this._consumeProbeCommand();
            this._writeProbe({ event: 'poll' });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _consumeProbeCommand() {
        const dir = GLib.getenv('XDG_STATE_HOME');
        if (!dir)
            return;
        const file = Gio.File.new_for_path(GLib.build_filenamev([dir, 'pub-probe.cmd']));
        if (!file.query_exists(null))
            return;
        let command = '';
        try {
            const [, bytes] = file.load_contents(null);
            command = new TextDecoder().decode(bytes).trim();
            file.delete(null);
        } catch (_error) {
            return;
        }
        const [verb, arg] = command.split(':');
        if (verb === 'click')
            this._probePointerClick();
        else if (verb === 'close')
            this.menu.close();
        else if (verb === 'open')
            this._openMainMenu();
        else if (verb === 'page') {
            if (this.menu.isOpen) {
                this._go(arg);
            } else {
                this._pendingPage = arg;
                this._openMainMenu();
            }
        } else if (verb === 'select')
            this._selected = arg;
        else if (verb === 'paste')
            this._beginPaste(arg);
        else if (verb === 'context')
            this._openContext();
        else if (verb === 'shot')
            this._probeScreenshot(arg || 'pub-shot');
        else if (verb === 'login') {
            this._selected = arg;
            this._startCliLogin(arg);
        } else if (verb === 'code' && this._cli)
            this._submitLoginCode(this._cli, command.slice('code:'.length));
        else if (verb === 'reload')
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._ext.reload();
                return GLib.SOURCE_REMOVE;
            });
        else if (verb === 'move' || verb === 'down' || verb === 'up' || verb === 'tap')
            this._probePointer(verb, arg);
    }

    _probePointer(verb, arg) {
        try {
            if (!this._probeDevice) {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._probeDevice = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            }
            const device = this._probeDevice;
            const now = Clutter.get_current_event_time();
            if (arg) {
                const [x, y] = arg.split(',').map(Number);
                device.notify_absolute_motion(now, x, y);
            }
            if (verb === 'down' || verb === 'tap')
                device.notify_button(now + 1, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            if (verb === 'up' || verb === 'tap')
                device.notify_button(now + 2, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            this._writeProbe({ event: `probe-${verb}`, arg });
        } catch (error) {
            this._probeLastError = String(error);
            this._writeProbe({ event: 'probe-pointer-failed' });
        }
    }

    _probeScreenshot(name) {
        const dir = GLib.getenv('XDG_STATE_HOME');
        if (!dir)
            return;
        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([dir, `${name}.png`]));
            const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const shooter = new Shell.Screenshot();
            shooter.screenshot(false, stream).then(() => {
                stream.close(null);
                this._writeProbe({ event: 'shot', name });
            }).catch(error => {
                this._probeLastError = String(error);
                this._writeProbe({ event: 'shot-failed', name });
            });
        } catch (error) {
            this._probeLastError = String(error);
            this._writeProbe({ event: 'shot-failed', name });
        }
    }

    _probePointerClick() {
        try {
            const [ax, ay] = this.get_transformed_position();
            const x = ax + Math.max(8, this.width / 2);
            const y = ay + Math.max(4, this.height / 2);
            const seat = Clutter.get_default_backend().get_default_seat();
            const virt = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            const now = Clutter.get_current_event_time();
            virt.notify_absolute_motion(now, x, y);
            virt.notify_button(now, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            virt.notify_button(now + 1, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            this._writeProbe({ event: 'probe-click', x, y });
        } catch (error) {
            this._probeLastError = String(error);
            console.error('[DEBUG-pub1] probe click failed', error);
            this._writeProbe({ event: 'probe-click-failed' });
        }
    }

    destroy() {
        this._alive = false;
        this._endDrag(false);
        this._cancelLogin();
        this._killEngine();
        if (this._probeTimer) {
            GLib.Source.remove(this._probeTimer);
            this._probeTimer = 0;
        }
        if (this._menuLater) {
            GLib.Source.remove(this._menuLater);
            this._menuLater = 0;
        }
        if (this._schemeId) {
            St.Settings.get().disconnect(this._schemeId);
            this._schemeId = 0;
        }
        if (this._themeChangedId) {
            this._themeContext.disconnect(this._themeChangedId);
            this._themeChangedId = 0;
        }
        if (this._stripIdle) {
            GLib.Source.remove(this._stripIdle);
            this._stripIdle = 0;
        }
        if (this._context) {
            this._contextManager?.removeMenu(this._context);
            this._context.destroy();
            this._context = null;
            this._contextManager = null;
        }
        super.destroy();
    }
});

export class PubRuntime {
    constructor(extension) {
        this._ext = extension;
        this._indicator = null;
    }

    enable() {
        this._indicator = new PubIndicator(this._ext);
        Main.panel.addToStatusArea(this._ext.uuid, this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
