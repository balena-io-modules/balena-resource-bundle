# Resource Bundle SDK

A *Resource Bundle* is a file format that can carry arbitrary metadata and associated file-based payloads, and allows for streaming creation and consumption. It is a tarball with a specific file structure. It also supports signing.

Resource bundles on their own are not very useful — they're merely the scaffolding and associated toolkit for creating other file formats. These are called *bundle types*.

This project is a Typescript SDK for creating and consuming resource bundles.

## Installing

```
npm install --save @balena/resource-bundle
```

## Usage

Assume a bundle of type `com.example.concat@1` with the following manifest schema:

```typescript
interface ConcatManifest {
  files: string[],
  separator: string,
}
```

To create a bundle you use the `create` function to get back an object that will allow you to add resources to the bundle and ultimately stream its contents to whatever destination you desire.

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import { create } from '@balena/resource-bundle';

const myBundle = create<ConcatManifest>({
  type: 'com.example.concat@1',
  manifest: {
    files: ['a.txt', 'b.txt'],
    separator: ' ',
  },
  resources: [
    {
      id: 'a.txt',
      size: 5,
      digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    },
    {
      id: 'b.txt',
      size: 5,
      digest: 'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
    },
  ],
});

const hello = stringToStream('hello');
myBundle.addResource('a.txt', hello);

const world = stringToStream('world');
myBundle.addResource('b.txt', world);

myBundle.finalize();

const dest = fs.createWriteStream('./mybundle.tar');
await stream.pipeline(myBundle.stream, dest);
```

You can read a resource bundle and extract the manifest and payload like so:

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import { open } from '@balena/resource-bundle';

const src = fs.createReadStream('./mybundle.tar');
const myBundle = bundle.open<ConcatManifest>(src, 'com.example.concat@1');

const manifest = await myBundle.manifest();
// > { files: ['a.txt', 'b.txt'], separator: ' ' }

const strings = new Array<string>();

for await (const { resource } of myBundle.resources()) {
  const contents = await streamToString(resource);
  strings.push(contents);
}

strings.join(manifest.separator);
// > hello world

```


## Resource Bundle format

The contents of a resource bundle look like this:

```
/contents.json
/contents.sig
/resources/dead45beef34
/resources/...
```

### `/contents.json`

A JSON file describing the contents of the bundle. This file must be added first to the tar stream so that clients can seek to it quickly and determine how to best use the bundle, possibly in a streaming fashion. The contents.json for an hypothetical bundle type looks like the following:

```json
{
  "version": 1,
  "type": "com.example.concat@1",
  "manifest": {
    "files": [ "a.txt", "b.txt" ],
    "separator": " "
  },
  "resources": [
    {
      "id": "a.txt",
      "size": 567,
      "digest": "sha256:deadbeef"
    },
    {
      "id": "b.txt",
      "size": 765,
      "digest": "sha256:cafebabe"
    }
  ]
}
```

#### `version`

The file format version; integer; currently 1. This is not SemVer, only a single integer is supported.

The format is allowed to be extended with new attributes and files without bumping the version. Clients must ignore attributes and files that they don't know how to handle and only work with those they do.

#### `type`

A string describing the kind of payload contained in the bundle, which in turn signifies what backend can be used to work with it (eg. “release”, "docker", "binary"), as well as its manifest schema version (eg. "release@6").

The exact format of the type key is `<backend-identifier>@<manifest-version>` but either part around `@` can be arbitrary ASCII. `<backend-identifier>` must be globally unique, so to avoid clashes it is suggested to be prefixed with the reverse domain of its owner.

For example, `type: "com.example.concat@6"` signifies that the payload is of type "concat" in `example.com` organization's namespace and its manifest is of version 6 (could also be "4.1" or "v5.3.2" or even "bar").

#### `manifest`

This is type-specific and it can be any valid JSON type. It's important to note that changing the schema of this attribute and, hence, its type version, does not propagate as a change to the file format version (ie. the `version` key).

#### `resources`

An array of dictionaries describing resources contained in the bundle. The schema format looks like this:

```json
[
  {
    "id": "some-unique-identifier",
    "size": 1234,
    "digest": "sha256:deadbeef",
    "type": "arbitrary-user-defined-optional-string"
  },
  ...
]
```

The `id` field can be used to uniquely associate the resource payload with the manifest. The `type` field is an optional opaque string that can be used to further describe the resource.

### `./contents.sig`

This file must be added into the tar stream immediately after `/contents.json`.

It contains the SHA-256 digest of the binary contents of contents.json file. It optionally contains the ECDSA or RSA signature of the binary contents of `/contents.json`, encoded as base64.

The `/contents.json` file requires checksums of the bundle's resources (ie. the entries in resources key), so signing and then validating its contents is good enough to ensure authenticity, and avoids a separate read effectively over all data to compute the signature (which would exclude use cases that stream data into the bundle and subsequently into the client directly). This however does not prevent a type from embedding a signature for each separate resource and verifying it individually.

### `./resources` directory

Contains the payload, as a series of blobs named after the SHA256 digest of their respective resource ID.


## License

This project is distributed under the Apache 2.0 license.

Copyright (c) 2024 Balena Ltd.
