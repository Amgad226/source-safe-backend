import { Injectable } from '@nestjs/common';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { File } from '@prisma/client';
import { MyConfigService } from 'src/my-config/my-config.service';
import { GoogleDriveService } from 'src/google-drive/google-drive.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from 'src/prisma/prisma.service';
import { FileProps } from 'src/google-drive/props/create-folder.props';
import { TokenPayloadProps } from 'src/base-module/token-payload-interface';

@Injectable()
export class FolderService {
  constructor(
    private myConfigService: MyConfigService,
    private googleDrive: GoogleDriveService,
    private prisma: PrismaService,

    @InjectQueue('google-drive') private readonly googleDriveQueue: Queue,
  ) {}

  async create(
    { name, parentFolderId }: CreateFolderDto,
    fileDetails: FileProps,
    tokenPayload: TokenPayloadProps,
  ) {
    const folder = await this.prisma.folder.create({
      data: {
        logo: fileDetails.filename,
        name,
        parentFolder: {
          connect: { id: 1 },
        },
      },
    });
    await this.prisma.userFolder.create({
      data: {
        folder_id: folder.id,
        folder_role_id: 1, // FIXME must get admin folder role by query
        user_id: tokenPayload.user.id,
      },
    });
    return folder;
  }

  async findAll() {
    return `This action returns all folder`;
  }

  findOne(id: number) {
    return `This action returns a #${id} folder`;
  }

  update(id: number, updateFolderDto: UpdateFolderDto) {
    return `This action updates a #${id} folder`;
  }

  remove(id: number) {
    return `This action removes a #${id} folder`;
  }
}
