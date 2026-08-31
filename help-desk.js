/* Help Desk — barangay filter.

   This is an enhancement and nothing more. With this file blocked, failing, or
   still downloading, all thirteen barangays are already on the page in full,
   in alphabetical order, each with its number as a working tel: link. That is
   deliberate and it is the whole design rule for this page: an emergency
   number must never depend on a script having loaded.

   So the search box is hidden until this file runs. A filter input that does
   nothing when typed into is worse than no filter — somebody types their
   barangay, sees the list not respond, and concludes the page is broken while
   the number they need is sitting further down it. */
(() => {
  const input = document.getElementById('brgySearch');
  const list = document.getElementById('brgyList');
  const status = document.getElementById('brgyStatus');
  if (!input || !list) return;

  const rows = [...list.querySelectorAll('.hd-brgy')];
  if (!rows.length) return;

  const filter = document.querySelector('.hd-filter');
  if (filter) filter.hidden = false;

  const apply = () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;

    rows.forEach((row) => {
      // Substring rather than prefix: "poblacion" should reach both North and
      // South, and somebody who knows the second half of a name should not
      // have to guess the first.
      const match = !query || row.dataset.name.includes(query);
      row.hidden = !match;
      if (match) shown += 1;
    });

    if (!status) return;
    if (!query) {
      status.textContent = '';
    } else if (shown === 0) {
      // Never a dead end. If the name does not match, the municipal numbers
      // above still answer, and saying so costs one sentence.
      status.textContent =
        `No barangay matches "${input.value.trim()}". Check the spelling, or use the emergency numbers above.`;
    } else {
      status.textContent = `${shown} of ${rows.length} barangays shown.`;
    }
  };

  input.addEventListener('input', apply);

  // Escape clears, as it would in any search field. Also restores the full
  // list, so a stray keystroke can never leave somebody looking at nothing.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      input.value = '';
      apply();
    }
  });
})();
