### `posts`

| Field | Type | Required | Relation | Settings |
| ----- | ---- | -------- | -------- | -------- |
| `id` | uuid | Yes | Primary key | Auto-generated |
| `body` | text | No | -- | -- |
| `created_at` | timestamp | Yes | -- | Default: `now()` |
| `published` | boolean | Yes | -- | Default: false |
| `title` | varchar(255) | Yes | -- | -- |
