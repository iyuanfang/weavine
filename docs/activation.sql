-- Activation tracking queries for weavine-server.
--
-- One row per unique install in `install_activation`, joined with
-- `devices` once the user logs in. The same UUID minted on first
-- launch is the PK in both tables, so a single JOIN surfaces
-- multi-device users.

-- 1. Total installs ever (includes never-logged-in)
SELECT COUNT(*) AS total_installs
FROM install_activation;

-- 2. DAU / WAU / MAU (last_seen in window)
SELECT COUNT(DISTINCT install_id) AS mau
FROM install_activation
WHERE last_seen_at > NOW() - INTERVAL '30 days';

-- 3. Pure cloud users (used the service key but never logged in)
SELECT COUNT(*) AS anonymous_users
FROM install_activation
WHERE install_id NOT IN (
    SELECT id FROM devices WHERE revoked_at IS NULL
);

-- 4. Logged-in users (active, not revoked)
SELECT COUNT(DISTINCT user_id) AS logged_in_users
FROM devices
WHERE revoked_at IS NULL;

-- 5. Multi-device users (one user, ≥2 distinct installs)
SELECT COUNT(*) AS multi_device_users
FROM (
    SELECT user_id
    FROM devices
    WHERE revoked_at IS NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
) t;

-- 6. Platform breakdown
SELECT platform, COUNT(*) AS installs
FROM install_activation
GROUP BY platform
ORDER BY installs DESC;

-- 7. App version breakdown (live installs, last 30d)
SELECT app_version, COUNT(*) AS installs
FROM install_activation
WHERE last_seen_at > NOW() - INTERVAL '30 days'
GROUP BY app_version
ORDER BY installs DESC;

-- 8. New activations per day (last 30 days)
SELECT DATE(first_seen_at) AS day, COUNT(*) AS new_activations
FROM install_activation
WHERE first_seen_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(first_seen_at)
ORDER BY day DESC;

-- 9. Cloud call volume by event type
SELECT last_event, COUNT(*) AS total_calls, SUM(call_count) AS summed_calls
FROM install_activation
GROUP BY last_event;

-- 10. Anon-then-logged-in cohort (full funnel proof)
SELECT
    COUNT(*) FILTER (WHERE install_id IN (SELECT id FROM devices)) AS logged_in,
    COUNT(*) AS total
FROM install_activation;
