### `collection_name`

| Field     | Type    | Required | Relation       | Settings                              |
| --------- | ------- | -------- | -------------- | ------------------------------------- |
| `id`      | UUID    | Yes      | Primary key    | Auto-generated                        |
| `field_1` | decimal | Yes      | --             | --                                    |
| `field_3` | UUID    | No       | M2O to brokers | Required, Foreign Key                 |
| `field_4` | String  | No       |                | Enum: "one" (default); "two"; "three" |