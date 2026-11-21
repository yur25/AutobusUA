CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    full_name varchar(120) NOT NULL,
    phone varchar(16) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('PASSENGER', 'CARRIER', 'ADMIN')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carrier_application (
    id uuid PRIMARY KEY,
    applicant_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    full_name varchar(120) NOT NULL,
    phone varchar(16) NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
    rejection_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    CHECK (
        (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
        OR
        (status = 'VERIFIED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
        OR
        (status = 'REJECTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX carrier_application_one_pending_per_user
    ON carrier_application (applicant_id)
    WHERE status = 'PENDING';
CREATE INDEX carrier_application_created_id_idx
    ON carrier_application (created_at DESC, id);

CREATE TABLE trip (
    id uuid PRIMARY KEY,
    carrier_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    origin varchar(120) NOT NULL,
    destination varchar(120) NOT NULL,
    departure_at timestamptz NOT NULL,
    arrival_at timestamptz NOT NULL,
    price numeric(10, 2) NOT NULL CHECK (price > 0),
    capacity integer NOT NULL CHECK (capacity > 0),
    occupied_seats integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (arrival_at > departure_at),
    CHECK (occupied_seats >= 0 AND occupied_seats <= capacity),
    CHECK (lower(btrim(origin)) <> lower(btrim(destination)))
);

CREATE INDEX trip_departure_id_idx ON trip (departure_at, id);
CREATE INDEX trip_carrier_departure_idx ON trip (carrier_id, departure_at, id);

CREATE TABLE ticket (
    id uuid PRIMARY KEY,
    passenger_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    trip_id uuid NOT NULL REFERENCES trip(id) ON DELETE RESTRICT,
    price numeric(10, 2) NOT NULL CHECK (price > 0),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
    purchased_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    CHECK (
        (status = 'ACTIVE' AND cancelled_at IS NULL)
        OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX ticket_one_active_per_passenger_trip
    ON ticket (passenger_id, trip_id)
    WHERE status = 'ACTIVE';
CREATE INDEX ticket_passenger_purchased_idx
    ON ticket (passenger_id, purchased_at DESC, id);

CREATE TABLE user_session (
    id_hash char(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_session_expiry_idx ON user_session (expires_at);

CREATE TABLE idempotency_record (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    operation varchar(120) NOT NULL,
    key_hash char(64) NOT NULL,
    request_hash char(64) NOT NULL,
    status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    response_status integer,
    response_body jsonb,
    resource_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    UNIQUE (user_id, operation, key_hash),
    CHECK (
        (status = 'IN_PROGRESS' AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
        OR
        (status = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);
CREATE INDEX idempotency_expiry_idx ON idempotency_record (expires_at);
