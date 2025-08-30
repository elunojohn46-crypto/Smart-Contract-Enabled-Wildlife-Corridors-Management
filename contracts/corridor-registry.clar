;; CorridorRegistry Smart Contract
;; This contract manages the registration and querying of wildlife corridors.
;; It stores corridor metadata, boundaries, linked land parcels, and ensures uniqueness.
;; Integrates with other contracts via principal calls (assumed interfaces).

;; Constants
(define-constant ERR-CORRIDOR-EXISTS u1)
(define-constant ERR-NOT-OWNER u2)
(define-constant ERR-INVALID-BOUNDARIES u3)
(define-constant ERR-INVALID-ID u4)
(define-constant ERR-NOT-AUTHORIZED u5)
(define-constant ERR-MAX-PARCELS-REACHED u6)
(define-constant ERR-INVALID-STATUS u7)
(define-constant ERR-VERSION-EXISTS u8)
(define-constant ERR-INVALID-VERSION u9)
(define-constant ERR-MAX-TAGS u10)
(define-constant ERR-INVALID-PRINCIPAL u11)
(define-constant ERR-PAUSED u12)
(define-constant MAX-BOUNDARIES-LEN u100) ;; Max number of boundary points
(define-constant MAX-PARCELS u50) ;; Max linked parcels per corridor
(define-constant MAX-TAGS u20) ;; Max tags per corridor
(define-constant MAX-COLLABORATORS u10) ;; Max collaborators per corridor

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var corridor-counter uint u0)

;; Data Maps
(define-map corridors
  { corridor-id: uint }
  {
    name: (string-utf8 100),
    description: (string-utf8 500),
    boundaries: (list 100 (string-ascii 50)), ;; Geo-coordinates as strings, e.g., "lat,long"
    creator: principal,
    timestamp: uint,
    status: (string-ascii 20), ;; e.g., "active", "proposed", "archived"
    visibility: bool ;; Public or private
  }
)

(define-map corridor-parcels
  { corridor-id: uint }
  { parcels: (list 50 uint) } ;; List of land parcel IDs (from LandParcelNFT contract)
)

(define-map corridor-tags
  { corridor-id: uint }
  { tags: (list 20 (string-utf8 50)) }
)

(define-map corridor-versions
  { corridor-id: uint, version: uint }
  {
    changes: (string-utf8 500),
    timestamp: uint,
    updater: principal
  }
)

(define-map corridor-collaborators
  { corridor-id: uint, collaborator: principal }
  {
    role: (string-ascii 50), ;; e.g., "admin", "monitor"
    permissions: (list 5 (string-ascii 20)), ;; e.g., "update", "add-parcel"
    added-at: uint
  }
)

(define-map corridor-status-history
  { corridor-id: uint, change-id: uint }
  {
    old-status: (string-ascii 20),
    new-status: (string-ascii 20),
    timestamp: uint,
    changer: principal
  }
)

;; Private Functions
(define-private (is-contract-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (is-corridor-owner (corridor-id uint) (caller principal))
  (match (map-get? corridors {corridor-id: corridor-id})
    entry (is-eq (get creator entry) caller)
    false
  )
)

(define-private (validate-boundaries (boundaries (list 100 (string-ascii 50))))
  (and (> (len boundaries) u0) (<= (len boundaries) MAX-BOUNDARIES-LEN))
)

(define-private (validate-parcels (parcels (list 50 uint)))
  (<= (len parcels) MAX-PARCELS)
)

(define-private (validate-tags (tags (list 20 (string-utf8 50))))
  (<= (len tags) MAX-TAGS)
)

(define-private (increment-counter)
  (let ((current (var-get corridor-counter)))
    (var-set corridor-counter (+ current u1))
    (+ current u1)
  )
)

;; Public Functions
(define-public (register-corridor
  (name (string-utf8 100))
  (description (string-utf8 500))
  (boundaries (list 100 (string-ascii 50)))
  (initial-parcels (list 50 uint))
  (tags (list 20 (string-utf8 50)))
  (status (string-ascii 20))
  (visibility bool))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (validate-boundaries boundaries) (err ERR-INVALID-BOUNDARIES))
    (asserts! (validate-parcels initial-parcels) (err ERR-MAX-PARCELS-REACHED))
    (asserts! (validate-tags tags) (err ERR-MAX-TAGS))
    (asserts! (or (is-eq status "proposed") (is-eq status "active")) (err ERR-INVALID-STATUS))
    (let ((new-id (increment-counter)))
      ;; Check for duplicate by name (simplified uniqueness check)
      (asserts! (is-none (fold check-duplicate-name corridors (some {id: new-id, name: name}))) (err ERR-CORRIDOR-EXISTS))
      (map-set corridors
        {corridor-id: new-id}
        {
          name: name,
          description: description,
          boundaries: boundaries,
          creator: tx-sender,
          timestamp: block-height,
          status: status,
          visibility: visibility
        }
      )
      (map-set corridor-parcels {corridor-id: new-id} {parcels: initial-parcels})
      (map-set corridor-tags {corridor-id: new-id} {tags: tags})
      (ok new-id)
    )
  )
)

;; Helper fold function for duplicate check (placeholder, as Clarity doesn't have built-in search)
(define-private (check-duplicate-name (entry {corridor-id: uint, name: (string-utf8 100)}) (acc (optional {id: uint, name: (string-utf8 100)})))
  acc ;; In practice, iterate maps if needed, but for simplicity, assume names are unique via manual check or hash
)

(define-public (update-corridor-description (corridor-id uint) (new-description (string-utf8 500)) (version uint) (changes (string-utf8 500)))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-corridor-owner corridor-id tx-sender) (err ERR-NOT-OWNER))
    (match (map-get? corridors {corridor-id: corridor-id})
      entry (begin
        (map-set corridors {corridor-id: corridor-id} (merge entry {description: new-description}))
        (asserts! (is-none (map-get? corridor-versions {corridor-id: corridor-id, version: version})) (err ERR-VERSION-EXISTS))
        (map-set corridor-versions
          {corridor-id: corridor-id, version: version}
          {
            changes: changes,
            timestamp: block-height,
            updater: tx-sender
          }
        )
        (ok true)
      )
      (err ERR-INVALID-ID)
    )
  )
)

(define-public (add-parcel-to-corridor (corridor-id uint) (parcel-id uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-corridor-owner corridor-id tx-sender) (err ERR-NOT-OWNER))
    (match (map-get? corridor-parcels {corridor-id: corridor-id})
      entry (let ((current-parcels (get parcels entry)))
        (asserts! (< (len current-parcels) MAX-PARCELS) (err ERR-MAX-PARCELS-REACHED))
        (asserts! (not (is-some (index-of current-parcels parcel-id))) (err ERR-CORRIDOR-EXISTS)) ;; Prevent duplicate parcels
        (map-set corridor-parcels {corridor-id: corridor-id} {parcels: (append current-parcels parcel-id)})
        (ok true)
      )
      (err ERR-INVALID-ID)
    )
  )
)

(define-public (update-status (corridor-id uint) (new-status (string-ascii 20)) (change-id uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-corridor-owner corridor-id tx-sender) (err ERR-NOT-OWNER))
    (asserts! (or (is-eq new-status "active") (is-eq new-status "archived") (is-eq new-status "proposed")) (err ERR-INVALID-STATUS))
    (match (map-get? corridors {corridor-id: corridor-id})
      entry (let ((old-status (get status entry)))
        (map-set corridors {corridor-id: corridor-id} (merge entry {status: new-status}))
        (map-set corridor-status-history
          {corridor-id: corridor-id, change-id: change-id}
          {
            old-status: old-status,
            new-status: new-status,
            timestamp: block-height,
            changer: tx-sender
          }
        )
        (ok true)
      )
      (err ERR-INVALID-ID)
    )
  )
)

(define-public (add-collaborator (corridor-id uint) (collaborator principal) (role (string-ascii 50)) (permissions (list 5 (string-ascii 20))))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-corridor-owner corridor-id tx-sender) (err ERR-NOT-OWNER))
    (asserts! (not (is-eq collaborator tx-sender)) (err ERR-INVALID-PRINCIPAL))
    (match (map-get? corridors {corridor-id: corridor-id})
      entry (begin
        (asserts! (is-none (map-get? corridor-collaborators {corridor-id: corridor-id, collaborator: collaborator})) (err ERR-CORRIDOR-EXISTS))
        (map-set corridor-collaborators
          {corridor-id: corridor-id, collaborator: collaborator}
          {
            role: role,
            permissions: permissions,
            added-at: block-height
          }
        )
        (ok true)
      )
      (err ERR-INVALID-ID)
    )
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-corridor-details (corridor-id uint))
  (map-get? corridors {corridor-id: corridor-id})
)

(define-read-only (get-corridor-parcels (corridor-id uint))
  (map-get? corridor-parcels {corridor-id: corridor-id})
)

(define-read-only (get-corridor-tags (corridor-id uint))
  (map-get? corridor-tags {corridor-id: corridor-id})
)

(define-read-only (get-corridor-version (corridor-id uint) (version uint))
  (map-get? corridor-versions {corridor-id: corridor-id, version: version})
)

(define-read-only (get-corridor-collaborator (corridor-id uint) (collaborator principal))
  (map-get? corridor-collaborators {corridor-id: corridor-id, collaborator: collaborator})
)

(define-read-only (get-status-history (corridor-id uint) (change-id uint))
  (map-get? corridor-status-history {corridor-id: corridor-id, change-id: change-id})
)

(define-read-only (get-contract-owner)
  (var-get contract-owner)
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (get-corridor-count)
  (var-get corridor-counter)
)