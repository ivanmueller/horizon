/* Hotel detail page — full-page replacement for the old drawer.
   Layout mirrors the production admin: header → 4-up hero strip
   → two-column body (sections left, sidebar cards right). */

function HotelDetailPage({ hotel, onBack }) {
  if (!hotel) return null;
  const refUrl = 'gowithhorizon.com/r/' + hotel.slug;
  return (
    <div>
      <div style={{padding:'12px 32px 0'}}>
        <button className="hd-back" onClick={onBack}>Hotels</button>
      </div>

      <header className="hd-head">
        <div className="hd-head__row">
          <div>
            <div className="hd-head__titlerow">
              <h1 className="hd-head__title">{hotel.name}</h1>
              <StatusPill status={hotel.status} />
            </div>
            <div className="hd-head__sub">
              <div className="hd-refurl">
                <span className="hd-refurl__text">{refUrl}</span>
                <button className="hd-refurl__btn" title="Copy options">▾</button>
              </div>
            </div>
          </div>
          <div className="hd-head__actions">
            <button className="btn">Send email</button>
            <button className="btn btn--primary"><I.plus size={14} /> Add employee</button>
            <button className="btn btn--icon" title="More actions">⋯</button>
          </div>
        </div>
      </header>

      <HotelHeroStat hotel={hotel} />

      <div className="hd-body">
        <main className="hd-main">
          <PlacementsSection hotel={hotel} />
          <ManagersSection />
          <EmployeesSection />
          <BookingsSection />
          <InvoicesSection />
          <PaymentsSection />
          <ActivitySection />
          <SentEmailsSection />
          <EventsSection />
        </main>

        <aside className="hd-side">
          <NotesPanel />
          <SetupGuide />
          <DetailsCard hotel={hotel} />
          <BankingCard />
          <CommissionCard hotel={hotel} />
        </aside>
      </div>
    </div>
  );
}

/* ── Hero stat strip ──────────────────────────────────────── */
function HotelHeroStat({ hotel }) {
  const conv = hotel.conversion || 8.2;
  const pending = Math.round(hotel.commission30d * 0.18);
  const lifetime = hotel.lifetimeCommission || (hotel.commission30d * 11.4 | 0);
  return (
    <div className="hd-herostat">
      <div className="hd-herostat__col">
        <div className="hd-herostat__label">Total commission</div>
        <div className="hd-herostat__value">CA$ {lifetime.toLocaleString()}</div>
        <div className="hd-herostat__sub">Lifetime · since {hotel.joined || 'Mar 2026'}</div>
      </div>
      <div className="hd-herostat__col">
        <div className="hd-herostat__label">Bookings</div>
        <div className="hd-herostat__value">{(hotel.bookings30d * 11.4 | 0).toLocaleString()}</div>
        <div className="hd-herostat__sub">{hotel.bookings30d} in the last 30 days</div>
      </div>
      <div className="hd-herostat__col">
        <div className="hd-herostat__label">Conversion rate</div>
        <div className="hd-herostat__value">{conv.toFixed(1)}%</div>
        <div className="hd-herostat__sub">scan → confirmed booking</div>
      </div>
      <div className="hd-herostat__col">
        <div className="hd-herostat__label">Pending payout</div>
        <div className="hd-herostat__value">CA$ {pending.toLocaleString()}</div>
        <div className="hd-herostat__sub">Next batch · Fri May 24</div>
      </div>
    </div>
  );
}

window.HotelDetailPage = HotelDetailPage;
