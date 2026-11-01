(function () {
  'use strict';

  var STORAGE_KEY = 'todos';

  var form = document.getElementById('new-todo-form');
  var input = document.getElementById('new-todo-input');
  var list = document.getElementById('todo-list');
  var emptyState = document.getElementById('empty-state');
  var countEl = document.getElementById('count');
  var clearDoneBtn = document.getElementById('clear-done');
  var filterBtns = Array.prototype.slice.call(document.querySelectorAll('.filter'));

  /** @type {{id: string, title: string, done: boolean}[]} */
  var todos = load();
  var filter = 'all';
  var editingId = null;

  // --- persistence ---

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(raw)) return [];
      // Drop anything that doesn't match the expected shape, so a corrupted
      // entry can't break rendering.
      return raw
        .filter(function (t) {
          return t && typeof t.id === 'string' && typeof t.title === 'string';
        })
        .map(function (t) {
          return { id: t.id, title: t.title, done: Boolean(t.done) };
        });
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (e) {
      // Storage full or disabled (e.g. private mode) — keep the session usable.
    }
  }

  function uid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return String(Date.now()) + Math.random().toString(36).slice(2);
  }

  function find(id) {
    return todos.filter(function (t) {
      return t.id === id;
    })[0];
  }

  // --- actions ---

  function add(title) {
    todos.push({ id: uid(), title: title, done: false });
    save();
    render();
  }

  function toggle(id) {
    var todo = find(id);
    if (!todo) return;
    todo.done = !todo.done;
    save();
    render();
  }

  function remove(id) {
    todos = todos.filter(function (t) {
      return t.id !== id;
    });
    if (editingId === id) editingId = null;
    save();
    render();
  }

  function rename(id, title) {
    var todo = find(id);
    if (!todo) return;
    title = title.trim();
    if (title === '') {
      remove(id); // Emptying a task is how you delete it while editing.
      return;
    }
    todo.title = title;
    editingId = null;
    save();
    render();
  }

  function clearDone() {
    todos = todos.filter(function (t) {
      return !t.done;
    });
    editingId = null;
    save();
    render();
  }

  // --- rendering ---

  function visible() {
    return todos.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    });
  }

  function renderTodo(todo) {
    var li = document.createElement('li');
    li.className = 'todo' + (todo.done ? ' done' : '');
    li.dataset.id = todo.id;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;
    checkbox.setAttribute('aria-label', 'Mark "' + todo.title + '" as done');
    checkbox.addEventListener('change', function () {
      toggle(todo.id);
    });
    li.appendChild(checkbox);

    if (editingId === todo.id) {
      var edit = document.createElement('input');
      edit.type = 'text';
      edit.className = 'edit';
      edit.value = todo.title;
      edit.maxLength = 200;

      var committed = false;
      function commit() {
        if (committed) return; // blur fires after Enter too — only apply once.
        committed = true;
        rename(todo.id, edit.value);
      }

      edit.addEventListener('blur', commit);
      edit.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          committed = true;
          editingId = null;
          render();
        }
      });

      li.appendChild(edit);
      // Focus after the node is in the document.
      requestAnimationFrame(function () {
        edit.focus();
        edit.setSelectionRange(edit.value.length, edit.value.length);
      });
    } else {
      var title = document.createElement('span');
      title.className = 'title';
      title.textContent = todo.title;
      title.title = 'Double-click to edit';
      title.addEventListener('dblclick', function () {
        editingId = todo.id;
        render();
      });
      li.appendChild(title);
    }

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete "' + todo.title + '"');
    del.addEventListener('click', function () {
      remove(todo.id);
    });
    li.appendChild(del);

    return li;
  }

  function render() {
    var items = visible();

    list.textContent = '';
    var frag = document.createDocumentFragment();
    items.forEach(function (todo) {
      frag.appendChild(renderTodo(todo));
    });
    list.appendChild(frag);

    var remaining = todos.filter(function (t) {
      return !t.done;
    }).length;
    var doneCount = todos.length - remaining;

    if (items.length === 0) {
      emptyState.hidden = false;
      emptyState.textContent =
        todos.length === 0
          ? 'Nothing here yet. Add your first task above.'
          : filter === 'active'
            ? 'No active tasks. Nice work.'
            : 'No completed tasks yet.';
    } else {
      emptyState.hidden = true;
    }

    countEl.textContent =
      remaining + (remaining === 1 ? ' task left' : ' tasks left');
    clearDoneBtn.disabled = doneCount === 0;

    filterBtns.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
    });
  }

  // --- events ---

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = input.value.trim();
    if (title === '') return;
    add(title);
    input.value = '';
    input.focus();
  });

  clearDoneBtn.addEventListener('click', clearDone);

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filter = btn.dataset.filter;
      editingId = null;
      render();
    });
  });

  render();
})();
