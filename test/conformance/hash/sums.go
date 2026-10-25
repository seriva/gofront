package main

import (
	"fmt"
	"hash/adler32"
	"hash/crc32"
	"hash/fnv"
)

func main() {
	ascii := []byte("hello world 1234567890")
	nonAscii := []byte{0xe4, 0xb8, 0x96, 0xe7, 0x95, 0x8c, 0xf0, 0x9f, 0x91, 0x8b}

	// ── CRC32 ──
	fmt.Printf("crc32 IEEE ascii: 0x%08x\n", crc32.ChecksumIEEE(ascii))
	fmt.Printf("crc32 IEEE nonAscii: 0x%08x\n", crc32.ChecksumIEEE(nonAscii))

	castTab := crc32.MakeTable(crc32.Castagnoli)
	fmt.Printf("crc32 Castagnoli ascii: 0x%08x\n", crc32.Checksum(ascii, castTab))
	fmt.Printf("crc32 Castagnoli nonAscii: 0x%08x\n", crc32.Checksum(nonAscii, castTab))

	koopTab := crc32.MakeTable(crc32.Koopman)
	fmt.Printf("crc32 Koopman ascii: 0x%08x\n", crc32.Checksum(ascii, koopTab))
	fmt.Printf("crc32 Koopman nonAscii: 0x%08x\n", crc32.Checksum(nonAscii, koopTab))

	hCrc := crc32.NewIEEE()
	hCrc.Write(ascii[:5])
	hCrc.Write(ascii[5:])
	fmt.Printf("crc32 streaming Sum32: 0x%08x\n", hCrc.Sum32())
	fmt.Printf("crc32 streaming Sum: %x\n", hCrc.Sum(nil))
	hCrc.Reset()
	hCrc.Write(ascii)
	fmt.Printf("crc32 after reset Sum32: 0x%08x\n", hCrc.Sum32())

	// ── Adler32 ──
	fmt.Printf("adler32 ascii: 0x%08x\n", adler32.Checksum(ascii))
	fmt.Printf("adler32 nonAscii: 0x%08x\n", adler32.Checksum(nonAscii))

	hAdler := adler32.New()
	hAdler.Write(ascii[:5])
	hAdler.Write(ascii[5:])
	fmt.Printf("adler32 streaming Sum32: 0x%08x\n", hAdler.Sum32())
	fmt.Printf("adler32 streaming Sum: %x\n", hAdler.Sum(nil))
	hAdler.Reset()
	hAdler.Write(ascii)
	fmt.Printf("adler32 after reset Sum32: 0x%08x\n", hAdler.Sum32())

	// ── FNV-32 / FNV-32a ──
	f32 := fnv.New32()
	f32.Write(ascii)
	fmt.Printf("fnv32 ascii: 0x%08x\n", f32.Sum32())
	fmt.Printf("fnv32 Sum: %x\n", f32.Sum(nil))

	f32a := fnv.New32a()
	f32a.Write(ascii)
	fmt.Printf("fnv32a ascii: 0x%08x\n", f32a.Sum32())
	fmt.Printf("fnv32a Sum: %x\n", f32a.Sum(nil))

	f32a.Reset()
	f32a.Write(nonAscii)
	fmt.Printf("fnv32a nonAscii: 0x%08x\n", f32a.Sum32())
}
