import QtQuick
import Quickshell
import Quickshell.Io

// A second pet Omatree can host in its canopy: Omarchy Pets
// (raiden-meixelysia.omarchy-pets), which plays Codex Pets sprite sheets.
//
// Unlike the Omagotchi coupling this is purely visual — Omarchy Pets has no
// lifecycle, hunger or mood to read and exposes no service, so there is
// nothing to tend and nothing to feed. All this does is find which pet the
// user has picked and where its sprite sheet is, so the same canopy perch can
// show it.
//
// Entirely on Omatree's side and read-only: it reads the shell layout to see
// whether the widget is in the bar and which pet is selected, then the pet's
// own `pet.json` for the sheet path. It never writes anything, never runs the
// pet plugin, and needs no cooperation from it. Absent — the common case —
// `present` is false and the perch renders nothing, exactly as before.
QtObject {
  id: r

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string moduleId: "raiden-meixelysia.omarchy-pets"

  // ---- the shell layout: is the widget in the bar, and which pet? --------
  readonly property FileView _shellFile: FileView {
    path: r.home ? r.home + "/.config/omarchy/shell.json" : ""
    preload: true
    blockLoading: true
    watchChanges: true
    printErrors: false
  }

  readonly property var _widget: {
    var raw = _shellFile.text()
    if (!raw)
      return null
    var d
    try {
      d = JSON.parse(raw)
    } catch (e) {
      return null
    }
    var lay = d && d.bar ? d.bar.layout : null
    if (!lay)
      return null
    var sections = ["left", "center", "right"]
    for (var s = 0; s < sections.length; s++) {
      var arr = lay[sections[s]] || []
      for (var i = 0; i < arr.length; i++)
        if (arr[i] && arr[i].id === r.moduleId)
          return arr[i]
    }
    return null
  }

  readonly property bool installed: _widget !== null

  readonly property string petsDir: {
    var raw = _widget && _widget.petsDir ? String(_widget.petsDir) : "~/.codex/pets"
    if (raw === "~")
      return r.home
    if (raw.indexOf("~/") === 0)
      return r.home + raw.slice(1)
    return raw
  }

  readonly property string _pickedId: _widget && _widget.petId ? String(_widget.petId) : ""

  // ---- no pet explicitly picked: take the first directory, like the pet
  //      plugin itself does -------------------------------------------------
  property string _firstId: ""
  readonly property Process _lister: Process {
    running: r.installed && r._pickedId === "" && r.petsDir !== ""
    command: ["sh", "-c",
      "find " + JSON.stringify(r.petsDir)
      + " -maxdepth 1 -mindepth 1 -type d -printf '%f\\n' 2>/dev/null | LC_ALL=C sort | head -1"]
    stdout: StdioCollector { id: _listOut; waitForEnd: true }
    onExited: r._firstId = _listOut.text.trim()
  }

  readonly property string petId: _pickedId !== "" ? _pickedId : _firstId
  readonly property string petDir: installed && petId !== "" ? petsDir + "/" + petId : ""

  // ---- the squad -------------------------------------------------------------
  // Every pet in the folder can come to the tree, not only the one the bar
  // shows. One bounded read-only sweep lists each directory's pet.json and
  // sprite sheet (capped at 8 members and 500 entries, exactly like the pets
  // plugin's own limits — Omatree just walks the same ground closer). The
  // picked pet still leads; the rest are companions looking for ground.
  // Omagotchi keeps precedence out in Service: while it is installed, no
  // squad forms at all.
  readonly property Process _squadScan: Process {
    running: r.installed && r.petsDir !== ""
    command: ["python3", "-c",
      "import json,os,sys\n"
      + "root=sys.argv[1]; out=[]\n"
      + "try: entries=sorted(os.listdir(root))\n"
      + "except OSError: entries=[]\n"
      + "for name in entries[:500]:\n"
      + "  if len(out)>=8: break\n"
      + "  dirp=os.path.join(root,name); pj=os.path.join(dirp,'pet.json')\n"
      + "  try:\n"
      + "    if not os.path.isdir(dirp): continue\n"
      + "    m=json.load(open(pj))\n"
      + "    sp=m.get('spritesheetPath')\n"
      + "    if not isinstance(sp,str) or '/' in sp or '..' in sp: continue\n"
      + "    if not os.path.isfile(os.path.join(dirp,sp)): continue\n"
      + "    nm=m.get('displayName')\n"
      + "    out.append({'id':name,'name':str(nm) if isinstance(nm,str) and nm else name,"
      + " 'dir':dirp,'sheet':sp})\n"
      + "  except (OSError,ValueError): continue\n"
      + "print(json.dumps(out))",
      r.petsDir]
    stdout: StdioCollector { id: _squadOut; waitForEnd: true }
    onExited: {
      try { r._squadRaw = JSON.parse(_squadOut.text || "[]") }
      catch (e) { r._squadRaw = [] }
    }
  }
  property var _squadRaw: []

  // Resolved squad view: file:// sheet urls, the picked member flagged.
  readonly property var squadMembers: {
    var out = []
    for (var i = 0; i < r._squadRaw.length; i++) {
      var s = r._squadRaw[i]
      if (!s || !s.dir || !s.sheet) continue
      out.push({
        id: s.id,
        name: s.name || s.id,
        picked: s.id === r.petId,
        sheetUrl: Qt.resolvedUrl("file://" + s.dir + "/" + s.sheet)
      })
    }
    // the picked pet leads; never duplicate it below
    out.sort(function (a, b) { return (b.picked === true) - (a.picked === true) })
    return out
  }

  // ---- the pet's own metadata: the sprite sheet path + its name ----------
  readonly property FileView _petJson: FileView {
    path: r.petDir !== "" ? r.petDir + "/pet.json" : ""
    preload: true
    blockLoading: true
    watchChanges: true
    printErrors: false
  }

  readonly property var _meta: {
    if (petDir === "")
      return null
    var raw = _petJson.text()
    if (!raw)
      return null
    try {
      return JSON.parse(raw)
    } catch (e) {
      return null
    }
  }

  // Everything resolved and the sheet exists → a pet can perch.
  readonly property bool present: _meta !== null && !!_meta.spritesheetPath && petDir !== ""
  readonly property url sheetUrl: present
    ? Qt.resolvedUrl("file://" + petDir + "/" + String(_meta.spritesheetPath))
    : ""
  readonly property string displayName:
    _meta && _meta.displayName ? String(_meta.displayName) : (petId || "Pet")
}
