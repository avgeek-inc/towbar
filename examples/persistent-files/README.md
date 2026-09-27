# Persistent file example

This small app demonstrates storing files on a Towbar app volume. It has no
user authentication; run it on a private test server only.

Copy `files.service.yml` to `.towbar/services/files.service.yml` in this repository, replace
the example server IP, and connect its production environment. Keep the app's
Dockerfile and server under `examples/persistent-files`.

POST a file to `/files`; the response contains its ID. GET `/files/<id>` to read
it and GET `/files` to list IDs. Uploads are limited to 1 MiB. After deploying a
new version or restarting the app, the same ID should return the same contents.
The `/app/uploads` directory belongs to the image's non-root `node` user.

App code rollback retains the latest files. These files stay on the target
server; this example does not provide backups or cross-server replication.
