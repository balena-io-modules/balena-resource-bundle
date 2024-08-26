# Resource Bundle SDK

A *Resource Bundle* is a file format that can carry arbitrary metadata and associated file-based payloads, and allows for streaming creation and consumption. It is a tarball with a specific file structure. It also ensures contents integrity and supports signing.

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
  separator: string,
}
```

### Creating a bundle

To create a bundle, use `create` to get a stream that you can use to pipe the bundle contents to whatever destination you desire.

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const myBundleStream = bundle.create<ConcatManifest>({
  type: 'com.example.concat@1',
  manifest: {
    separator: ' ',
  },
  resources: [
    {
      id: 'hello.txt',
      size: 5,
      digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      data: fs.createReadStream('./hello.txt'),
    },
    {
      id: 'world.txt',
      size: 5,
      digest: 'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
      data: fs.createReadStream('./world.txt'),
    },
  ]
});

const dest = fs.createWriteStream('./mybundle.tar');
await stream.pipeline(myBundleStream, dest);
```

### Reading a bundle

You can open a resource bundle and extract the manifest and resources like so:

```typescript
import * as fs from 'node:fs';
import * as bundle from '@balena/resource-bundle';

const src = fs.createReadStream('./mybundle.tar');
const myBundle = await bundle.open<ConcatManifest>(src, 'com.example.concat@1');

const manifest = myBundle.manifest;
// > { separator: ' ' }

const strings: string[] = [];

for (const descriptor of myBundle.resources) {
  const resource = myBundle.read(descriptor);
  // > { id: 'hello.txt', size: 5, digest: 'sha256:...', data: stream.Readable }
  const contents = await bundle.streamToString(resource.data);
  strings.push(contents);
}
strings.join(manifest.separator);
// > hello world
```

### Providing resource data lazily

You can provide the data for a resource "lazily" by passing an async function that eventually resolves with the actual data stream. The function will be invoked and awaited just before the resource needs to start being streamed into the bundle.

This allows you to delay performing work to fetch resource data (eg. via a network request) until the very last moment. This is particularly useful when opening a stream to fetch resource data early would risk timing out by the time it starts being written into the bundle.

```typescript
import * as fs from 'node:fs';
import * as bundle from '@balena/resource-bundle';

async function fetchFileData(resource: bundle.Resource): Promise<stream.Readable> {
  const filepath = await resolveResourceFilepath(resource.id);
  return fs.createReadStream(filepath);
}

bundle.create({
  // ...
  resources: [
    // ...
    {
      id: 'foo.bin',
      size: 15345,
      digest: 'sha256:deadbeef',
      data: fetchFileData,
    },
  ],
});
```

### Multipart resources

Many times, a resource is semantically one "unit" but actually comprises several parts--eg. a Docker image or a webpage archive--and it is undesirable or impractical to package them up in an archive before adding them into a bundle alongside other resources.

Resource bundles support streaming these resources directly into a bundle, without first having to wrap them into a single package--this wrapping is handled automatically for you. These resources are called *Multipart Resources* and you can work with them as if they're a single unit.

Multipart resources allow you to assemble a bundle from several individual resources or even other bundles, and read the bundle contents on the other side as they're being written, which has many applications on server/client environments.

```typescript
// Creating the bundle

import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const myBundleStream = bundle.create<ConcatManifest>({
  type: 'com.example.concat@1',
  manifest: {
    separator: ' ',
  },
  resources: [
    {
      id: 'hello.txt',
      size: 5,
      digest: 'sha256:....',
      data: fs.createReadStream('./hello.txt'),
    },
    {
      id: 'world!',
      contents: {
        type: 'com.example.concat@1',
        manifest: {
          separator: '',
        },
        resources: [
          {
            id: 'world.txt',
            size: 5,
            digest: 'sha256:...',
            data: fs.createReadStream('./world.txt'),
          },
          {
            id: 'exclamation.txt',
            size: 1,
            digest: 'sha256:...',
            data: fs.createReadStream('./exclamation.txt'),
          },
        ]
      },
    },
  ]
});

const dest = fs.createWriteStream('./mybundle.tar');
await stream.pipeline(myBundleStream, dest);

// Reading the bundle

import * as fs from 'node:fs';
import * as bundle from '@balena/resource-bundle';

const src = fs.createReadStream('./mybundle.tar');
const myBundle = await bundle.open<ConcatManifest>(src, 'com.example.concat@1');

const manifest = myBundle.manifest;
// > { separator: ' ' }

const strings: string[] = [];

for (const descriptor of myBundle.resources) {
  if (bundle.isMultipart(descriptor)) {
    const innerBundle = myBundle.readMultipart(descriptor);
    // > { type: 'com.example.concat@1', manifest: { separator: '' }, resources: [ ... ] }

    const innerManifest = innerBundle.manifest;
    // > { separator: '' }

    const innerStrings: string[] = [];

    for (const innerDescriptor of innerBundle.resources) {
      const resource = innerBundle.read(innerDescriptor);
      // > { id: 'world.txt', size: 5, digest: 'sha256:...', data: stream.Readable }
      const contents = await streamToString(resource.data);
      innerStrings.push(contents);
    }

    strings.push(innerStrings.join(innerManifest.separator));
  } else {
    const resource = myBundle.read(descriptor);
    // > { id: 'hello.txt', size: 5, digest: 'sha256:...', data: stream.Readable }
    const contents = await streamToString(resource.data);
    strings.push(contents);
  }
}

strings.join(manifest.separator);
// > hello world!
```

The code example above is deliberately verbose. In reality, the code for a bundle type that uses multipart resources would look more like the following:

```typescript
// Reading the bundle

import * as fs from 'node:fs';
import * as bundle from '@balena/resource-bundle';

async function readBundle(
  contents: bundle.ReadableBundle<ConcatManifest>,
): Promise<string> {
  const strings: string[] = [];

  for (const descriptor of contents.resources) {
    // Read resource ID and type and dispatch work to different functions
    // as appropriate.
    //
    // In this example we only deal with one type, `com.example.concat`,
    // so either perform the work directly or recurse back into this function
    // to read nested bundles storead as multipart resources.
    if (bundle.isMultipart(descriptor)) {
      const resource = contents.readMultipart<ConcatManifest>(descriptor);
      const contents = await readBundle(resource);
      strings.push(contents);
    } else {
      const resource = contents.read(descriptor);
      const contents = await streamToString(resource.data);
      strings.push(contents);
    }
  }

  return strings.join(contents.manifest.separator);
}

const src = fs.createReadStream('./mybundle.tar');
const myBundle = await bundle.open<ConcatManifest>(src, 'com.example.concat@1');
await readBundle(myBundle);
// > hello world!
```

Below is an example of adding a bundle as a multipart resource of another bundle:

```typescript
// Creating the bundle

import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const src = fs.createReadStream('./myotherbundle.tar'); // or network
const myOtherBundle = await bundle.open<ConcatManifest>(src, 'com.example.concat@1');

const myBundleStream = bundle.create<ConcatManifest>({
  type: 'com.example.concat@1',
  manifest: {
    separator: ' ',
  },
  resources: [
    {
      id: 'hello.txt',
      size: 5,
      digest: 'sha256:....',
      data: fs.createReadStream('./hello.txt'),
    },
    {
      id: 'myotherbundle.tar',
      contents: myOtherBundle.contents,
    }
  ]
});

const dest = fs.createWriteStream('./mybundle.tar'); // or network
await stream.pipeline(myBundleStream, dest);
```

### Working with Docker images

Creating a Docker image archive:

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const { ImageSet } = bundle.docker;

const imageSet = await ImageSet.fromImages(['ubuntu', 'alpine']);
const archiveStream = await imageSet.pack();
await stream.pipeline(archiveStream, fs.createWriteStream('./mybundle.tar'));
```

Creating an image set bundle:

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const { ImageSet } = bundle.docker;

const imageSet = await ImageSet.fromImages(['ubuntu', 'alpine']);
const myBundleStream = bundle.create(imageSet.contents);
await stream.pipeline(myBundleStream, fs.createWriteStream('./mybundle.tar'));
```

Adding an image set into a bundle as a multipart resource:

```typescript
import * as fs from 'node:fs';
import * as stream from 'node:stream';
import * as bundle from '@balena/resource-bundle';

const { ImageSet } = bundle.docker;

const imageSet = await ImageSet.fromImages(['ubuntu', 'alpine']);

const myBundleStream = bundle.create({
  type: 'mybundletype',
  manifest: { ... }
  resources: [
    {
      id: 'my-image-set',
      contents: imageSet.contents,
    },
  ]
});

await stream.pipeline(myBundleStream, fs.createWriteStream('./mybundle.tar'));
```

Reading an image set from a bundle:

```typescript
import * as bundle from '@balena/resource-bundle';

const { ImageSetManifest } = bundle.docker;

const myBundle = await bundle.open(myBundleStream, 'mybundletype');

for (const descriptor of myBundle.resources) {
  const resource = myBundle.readMultipart<ImageSetManifest>(descriptor);
  const imageSet = ImageSet.fromBundle(resource);
  // ...
}
```

## Resource Bundle format

A resource bundle is a tarball with the following contents:

```
/contents.json
/contents.sig
/resources/dead45beef34
/resources/...
```

Be mindful that unpacking a resource bundle and packing it up again will likely result in an unreadable bundle. The bundle contents have a strict order and the stream-ability of bundles depends on this order being maintained.

### `/contents.json`

A JSON file describing the contents of the bundle. This file must be added first to the tar stream so that clients can seek to it quickly and determine how to best use the bundle, possibly in a streaming fashion. The contents.json for an hypothetical bundle type looks like the following:

```json
{
  "schemaVersion": 1,
  "contents": {
    "type": "com.example.concat@1",
    "manifest": {
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
}
```

#### `schemaVersion`

The file format version; integer; currently 1. This is not SemVer, only a single integer is supported.

The format is allowed to be extended with new attributes and files without bumping the version. Clients must ignore attributes and files that they don't know how to handle and only work with those they do.

#### `contents`

The contents dictionary fully describes the bundle contents.

#### `contents.type`

A string describing the kind of payload contained in the bundle, which in turn signifies what backend can be used to work with it (eg. “release”, "docker", "binary"), as well as its manifest schema version (eg. "release@6").

The exact format of the type key is `<backend-identifier>@<manifest-version>` but either part around `@` can be arbitrary ASCII. `<backend-identifier>` must be globally unique, so to avoid clashes it is suggested to be prefixed with the reverse domain of its owner.

For example, `type: "com.example.concat@6"` signifies that the payload is of type "concat" in `example.com` organization's namespace and its manifest is of version 6 (could also be "4.1" or "v5.3.2" or even "bar").

#### `contents.manifest`

This is type-specific and it can be any valid JSON type. It's important to note that changing the schema of this attribute and, hence, its type version, does not propagate as a change to the file format version (ie. the `schemaVersion` key).

#### `contents.resources`

An array of dictionaries describing resources contained in the bundle. The schema format looks like this:

```json
{
  // ...
  "resources": [
    {
      "id": "some-unique-identifier",
      "size": 1234,
      "digest": "sha256:deadbeef",
      "type": "arbitrary-user-defined-optional-string",
      "aliases": [
        "an-alternative-id-for-this-resource"
        // ...
      ],
      "metadata": {
        "key": "value"
      }
    },
    ...
  ]
}
```

The `id` field can be used to uniquely associate the resource payload with the manifest. The `type` field is an optional opaque string that can be used to further describe the resource.

##### Multipart resources

The `resources` array can accomodate nested bundles or other resources that comprise multiple parts. These are called *Multipart Resources*. The schema for multipart resources is as follows:

```json
{
  // ...
  "resources": [
    {
      "id": "nested-multipart-resource",
      "type": "arbitrary-user-defined-optional-string",
      "aliases": [
        "an-alternative-id-for-this-resource"
        // ...
      ],
      "metadata": {
        "key": "value"
      },
      "contents": {
        // same schema as the bundle `contents` dictionary
      }
    },
    // ...
  ]
}
```

The fields `id`, `aliases`, `type` and `metadata` are the same as for non-multipart resources. The `contents` dictionary is the same as the bundle `contents` dictionary.

Multipart resources can themselves contain multipart resources recursively. To avoid malicious payload triggering a DoS attack due to runaway recursion, the "top level", or "main" bundle must be limited to a reasonable number of nesting levels that is no less than 10.

### `./contents.sig`

This file must be added into the tar stream immediately after `/contents.json`.

It contains the SHA-256 digest of the binary contents of contents.json file. It optionally contains the ECDSA or RSA signature of the binary contents of `/contents.json`, encoded as base64.

The `/contents.json` file requires checksums of the bundle's resources (ie. the entries in resources key), so signing and then validating its contents is good enough to ensure authenticity, and avoids a separate read effectively over all data to compute the signature (which would exclude use cases that stream data into the bundle and subsequently into the client directly). This however does not prevent a type from embedding a signature for each separate resource and verifying it individually.

### `./resources` directory

Contains the payload, as a series of blobs named after the SHA256 digest of their respective resource ID. Blobs are ordered in the same order as listed in `contents.resources`; this is important to enable streaming a bundle.


## License

This project is distributed under the Apache 2.0 license.

Copyright (c) 2024 Balena Ltd.
