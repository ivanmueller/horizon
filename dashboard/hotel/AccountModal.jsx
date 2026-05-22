/* Account-password modal — composed for the kit, mirrors the modal
   in dashboard/hotel/index.html with React state instead of vanilla. */
function AccountModal({ open, email, onClose, onSave }) {
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [err, setErr] = React.useState('');

  if (!open) return null;

  function submit(e) {
    e.preventDefault();
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== pw2)    { setErr('Passwords don’t match.'); return; }
    setErr('');
    onSave && onSave(pw);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target.classList.contains('modal-backdrop')) onClose(); }}>
      <form className="modal" onSubmit={submit}>
        <div className="modal__head">
          <div>
            <div className="modal__title">Account</div>
            <div className="modal__sub">Set a password to sign in faster next time.</div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && (
          <div style={{background:'var(--feedback-danger-bg)',border:'1px solid var(--feedback-danger-border)',color:'var(--feedback-danger-text)',padding:'8px 12px',borderRadius:'var(--radius-md)',fontSize:13}}>{err}</div>
        )}

        <div className="field">
          <label>Email</label>
          <input type="email" value={email} disabled />
        </div>
        <div className="field">
          <label>New password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required />
        </div>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">Save password</button>
        </div>
      </form>
    </div>
  );
}

window.AccountModal = AccountModal;
